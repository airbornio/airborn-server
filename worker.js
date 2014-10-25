var pg = require('pg.js');

var AWS = require('aws-sdk');
var s3 = new AWS.S3();

require('amqplib').connect(process.env.CLOUDAMQP_URL + '?heartbeat=1').then(function(conn) {
	return conn.createChannel().then(function(channel) {
		channel.assertQueue('tasks');
		channel.consume('tasks', function(message) {
			if(message === null) {
				console.error('Consumer was canceled');
				process.exit(1);
				return;
			}
			var action = message.properties.type;
			var metadata = message.properties.headers;
			var buffer = message.content;
			switch(action) {
				case 'putObject':
					s3.putObject({
						Bucket: 'laskya-cloud',
						Key: metadata.S3Prefix + '/' + metadata.name,
						ACL: 'public-read',
						ContentLength: metadata.size,
						Body: buffer
					}, function(err, data) {
						if(err) {
							console.error(err);
							channel.nackAll(false);
							return;
						}
						channel.ack(message);
					});
					break;
				case 'setObjectSize':
					pg.connect(process.env.DATABASE_URL, function(err, client, done) {
						if(err) {
							console.error(err);
							channel.nackAll(false);
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
								channel.nackAll(false);
								return;
							}
							channel.ack(message);
						}
					});
					break;
				default:
					console.error('Unknown message type: ' + action);
					channel.nackAll(false);
					break;
			}
		});
	});
}).then(null, function(err) {
	throw err;
});