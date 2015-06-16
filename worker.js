var pg = require('pg.js');

var AWS = require('aws-sdk');
var s3 = new AWS.S3();

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
					ACL: 'public-read',
					ContentLength: metadata.size,
					Body: buffer
				}, function(err, data) {
					if(err) {
						console.error(err);
						channel.nack(message);
						callback();
						return;
					}
					pg.connect(process.env.DATABASE_URL, function(err, client, done) {
						if(err) {
							console.error(err);
							channel.nack(message);
							callback();
							return;
						}
						client.query('INSERT INTO objects ("userId", name, size) VALUES ($1, $2, $3)', [metadata.userID, metadata.name, metadata.size], function(err, result) {
							if(err) {
								client.query('UPDATE objects SET size = $3 WHERE "userId" = $1 AND name = $2', [metadata.userID, metadata.name, metadata.size], cont);
							} else {
								cont(err, result);
							}
						});
						function cont(err, result) {
							done();
							if(err) {
								console.error(err);
								channel.nack(message);
								callback();
								return;
							}
							channel.ack(message);
							callback();
						}
					});
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