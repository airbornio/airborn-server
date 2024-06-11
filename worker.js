var pg = require('pg-promise')();
var client = pg(process.env.DATABASE_URL);

var AWS = require('aws-sdk-promise');
var s3 = new AWS.S3();

var amqplib = require('amqplib');

async function createConnection() {
	const connection = await amqplib.connect(process.env.CLOUDAMQP_URL + '?heartbeat=10');
	connection.on('error', function(err) {
		console.error('Connection was closed!')
		console.error(err);
		// The connection was closed by the server, open a new one.
		createConnection();
	});
	createChannel(connection);
}

async function createChannel(connection) {
	const channel = await connection.createChannel();
	channel.on('error', function(err) {
		console.error('Channel was closed!')
		console.error(err);
		// The channel was closed by the server, open a new one.
		createChannel(connection);
	});
	await channel.assertQueue('transactions');
	channel.consume('transactions', async function(message) {
		if(message === null) {
			console.error('Consumer was canceled');
			process.exit(1);
			return;
		}
		var action = message.properties.type;
		var metadata = message.properties.headers;
		switch(action) {
			case 'commit':
				await channel.assertQueue(metadata.queue);
				(function _getMessage() {
					getMessage(channel, metadata.queue, async function(done) {
						if(done) {
							await channel.ack(message);
							await channel.deleteQueue(metadata.queue, {ifEmpty: true}); // To be safe, but it should always be empty.
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
}

createConnection();

function getMessage(channel, queue, callback, getanother) {
	channel.get(queue).then(async function(message) {
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
							INSERT INTO objects ("userId", name, size, "ACL", authkey) VALUES ($1, $2, $3, $4, $5)
							ON CONFLICT ("userId", name) DO UPDATE
							SET (size, "ACL", authkey, "lastUpdated") = ($3, $4, $5, $6)
						`, [metadata.userID, metadata.name, metadata.size, metadata.ACL, metadata.objectAuthkey, Date.now()]);
					} else {
						return client.query(`
							INSERT INTO objects ("userId", name, size) VALUES ((SELECT id FROM users WHERE "S3Prefix" = $1), $2, $3)
							ON CONFLICT ("userId", name) DO UPDATE
							SET (size, "lastUpdated") = ($3, $4)
						`, [metadata.S3Prefix, metadata.name, metadata.size, Date.now()]);
					}
				}).then(async function() {
					await channel.ack(message);
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
				await channel.nack(message);
				callback();
				break;
		}
		getanother();
	}).catch(function(error) {
		console.error('channel.get error', error);
		throw error;
	});
}