var pg = require('pg-promise')();
var client = pg(process.env.DATABASE_URL);

var AWS = require('aws-sdk-promise');
var s3 = new AWS.S3();

var request = require('request');

require('amqplib').connect(process.env.CLOUDAMQP_URL + '?heartbeat=10').then(function(conn) {
	return conn.createChannel().then(function(channel) {
		channel.assertQueue('transactions');
		channel.consume('transactions', function(message) {
			if(message === null) {
				console.error('Consumer was canceled');
				process.exit(1);
				return;
			}
			var action = message.properties.type;
			var metadata = message.properties.headers;
			switch(action) {
				case 'commit':
					channel.assertQueue(metadata.queue);
					(function _getMessage() {
						getMessage(channel, metadata.queue, function(done) {
							if(done) {
								channel.ack(message);
								channel.deleteQueue(metadata.queue, {ifEmpty: true}); // To be safe, but it should always be empty.
								return;
							}
							_getMessage();
						}, function getanother() {
							getMessage(channel, metadata.queue, function() {}, getanother);
						});
					})();
					break;
				default:
					console.error('Unknown message type: ' + action);
					channel.nack(message);
					break;
			}
		});
	});
}).then(null, function(err) {
	throw err;
});

function getMessage(channel, queue, callback, getanother) {
	channel.get(queue).then(function(message) {
		if(message === false) {
			callback(true);
			return;
		}
		var action = message.properties.type;
		var metadata = message.properties.headers;
		var buffer = message.content;
		switch(action) {
			case 'putObject':
				s3.putObject({
					Bucket: process.env.S3_BUCKET_NAME,
					Key: metadata.S3Prefix + '/' + metadata.name,
					ContentLength: metadata.size,
					ACL: metadata.ACL,
					Body: buffer
				}).promise().then(function() {
					if(metadata.authenticated) {
						return client.query(`
							INSERT INTO objects ("userId", name, size, "ACL", authkey) VALUES ((SELECT id FROM users WHERE "S3Prefix" = $1), $2, $3, $4, $5)
							ON CONFLICT ("userId", name) DO UPDATE
							SET (size, "ACL", authkey, "lastUpdated") = ($3, $4, $5, $6)
						`, [metadata.S3Prefix, metadata.name, metadata.size, metadata.ACL, metadata.objectAuthkey, Date.now()]);
					} else {
						return client.query(`
							INSERT INTO objects ("userId", name, size) VALUES ($1, $2, $3)
							ON CONFLICT ("userId", name) DO UPDATE
							SET (size, "lastUpdated") = ($3, $4)
						`, [metadata.userID, metadata.name, metadata.size, Date.now()]);
					}
				}).then(function() {
					channel.ack(message);
					callback();
				}, function(err) {
					console.log(metadata);
					console.error(err);
					setTimeout(function() {
						channel.nack(message);
					}, (err.retryDelay || 1) * 1000);
					callback();
				});
				break;
			default:
				console.error('Unknown message type: ' + action);
				channel.nack(message);
				callback();
				break;
		}
		getanother();
	});
}

var lastInvalidated = Date.now();

setInterval(function() {
	client.query(`
		SELECT "userId", name, "lastUpdated" FROM objects WHERE
		"lastUpdated" >= $1
		ORDER BY "lastUpdated" ASC
		LIMIT 101
	`, [lastInvalidated]).then(function(rows) {
		if(rows.length) {
			var nextLastInvalidated =
				rows.length === 101 ? rows.pop().lastUpdated :
				rows[rows.length - 1].lastUpdated + 1;
			request.delete('https://api.keycdn.com/zones/purgeurl/' + process.env.KEYCDN_ZONE_ID + '.json', {
				auth: {
					user: process.env.KEYCDN_API_KEY
				},
				body: {
					urls: rows.map(function(row) {
						return process.env.KEYCDN_ZONE_URL + '/object/' + row.name;
					})
				},
				json: true,
			}, function(err, response) {
				if(err) {
					console.error(err);
					return;
				}
				if(response.body.status !== 'success') {
					console.error(response.body);
					return;
				}
				lastInvalidated = nextLastInvalidated;
			});
		}
	});
}, 1000 / 10); // 10 per second, to stay under the limit of 20 per second.