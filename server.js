var newrelic = require('newrelic');

var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var http = require('http');
var https = require('https');
var request = require('request-promise');
var JSZip = require('jszip');

var express = require('express');
var app = express();
var Mustache = require('mustache');
var marked = require('marked');
var compression = require('compression');

var pg = require('pg-promise')();
var client = pg(process.env.DATABASE_URL);

var AWS = require('aws-sdk-promise');
var s3 = new AWS.S3();

var Session = require('express-session');
var RedisStore = require('connect-redis')(Session);

var bodyParser = require('body-parser');

var redisParams = require('parse-redis-url')().parse(process.env.REDISCLOUD_URL);
var redis = require('redis').createClient(redisParams.port, redisParams.host);
redis.auth(redisParams.password);

var bruteStore = new (require('express-brute-redis'))({client: redis});
var brute = new (require('express-brute'))(bruteStore);

var geoip2 = require('geoip2');
geoip2.init();

var visualCaptcha;

var channel = require('amqplib').connect(process.env.CLOUDAMQP_URL + '?heartbeat=10').then(function(conn) {
	return conn.createChannel();
});
function queueTask(queue, type, metadata, buffer, callback) {
	channel.then(function(channel) {
		channel.assertQueue(queue);
		channel.sendToQueue(queue, buffer, {type: type, headers: metadata});
	}).then(callback, function(err) {
		callback(null, err);
	});
}

//app.use(compression());

app.use(bodyParser.json());

app.use(function(req, res, next) {
	if(req.method === 'GET') {
		res.set('Cache-control', 's-maxage=86400, max-age=300');
		res.set('X-GitHub-Commit', process.env.HEROKU_SLUG_COMMIT);
	}
	next();
});

var session = Session({
	secret: process.env.COOKIE_SESSION_SECRET,
	store: new RedisStore({client: redis}),
	resave: false,
	saveUninitialized: false
});
app.use(session);

var menu_html = fs.readFileSync('menu.mustache', 'utf8');

app.get('/', function(req, res) {
	res.sendfile('index.html');
});
app.get(/^\/(?:pako\.min|sjcl|login|crypto|analytics|serviceworker)\.js$/, function(req, res) {
	res.sendfile(req.path.substr(1));
});
app.get('/lang.json', function(req, res) {
	res.set('Access-Control-Allow-Origin', '*');
	res.sendfile('lang.json');
});
app.get(/^\/(?:app|demo|update)$/, function(req, res) {
	res.sendfile(req.path.substr(1) + '.html');
});
app.get(/^\/(?:content|content-app|register|demo)$/, function(req, res) {
	res.type('html');
	fs.readFile(req.path.substr(1) + '.mustache', 'utf8', function(err, contents) {
		res.send(200, Mustache.render(contents, {
			FORKME_URL: process.env.FORKME_URL,
		}, {
			menu: menu_html,
		}));
	});
});
app.get(/^\/(?:index|app|content|register|update|demo|plans|docs\/docs|terms|main)\.(?:js|css)$/, function(req, res) {
	res.sendfile(req.path.substr(1));
});
app.get(/^\/3rdparty\/.+\.(?:js|css|png)$/, function(req, res) {
	res.sendfile(req.path.substr(1).replace(/\.\./g, ''));
});
app.get(/^\/images\/.+\.(?:png|svg)$/, function(req, res) {
	res.sendfile(req.path.substr(1).replace(/\.\./g, ''));
});
app.get('/favicon.ico', function(req, res) {
	res.sendfile('favicon.ico');
});

app.get('/user/:username/exists', function(req, res) {
	res.set('Cache-control', 's-maxage=0');
	var username = req.param('username');
	req.session.username = username;
	client.query('SELECT salt FROM users WHERE username = $1', [username]).then(function(rows) {
		if(!rows[0]) {
			res.send(200, 'false');
			return;
		}
		res.send(200, 'true');
	}, function(err) {
		console.error(err);
		res.send(500);
		return;
	});
});

app.get('/user/:username/salt', function(req, res) {
	res.set('Cache-control', 's-maxage=0');
	var username = req.param('username');
	req.session.username = username;
	client.query('SELECT salt FROM users WHERE username = $1', [username]).then(function(rows) {
		if(!rows[0]) {
			res.send(404);
			return;
		}
		res.send(200, rows[0].salt);
	}, function(err) {
		console.error(err);
		res.send(500);
		return;
	});
});

app.get(/^\/object\/(.+)$/, function(req, res) {
	res.set('Cache-control', 's-maxage=86400, max-age=0');
	var username = req.get('X-Username');
	if(username) {
		req.session.username = username;
	}
	var authkey = req.get('X-Authentication');
	if(authkey) {
		brute.prevent(req, res, function() {
			login(req, res, authkey, cont);
		});
	} else if(req.get('X-S3Prefix') || userLoggedIn(req)) {
		cont();
	} else {
		res.send(403);
		return;
	}
	function cont() {
		res.set('Access-Control-Allow-Origin', process.env.USERCONTENT_URL);
		res.set('Access-Control-Allow-Headers', 'X-S3Prefix');
		var S3Prefix = req.get('X-S3Prefix') || req.session.S3Prefix;
		var authenticated = S3Prefix === req.session.S3Prefix;
		var stream = s3[authenticated ? 'makeRequest' : 'makeUnauthenticatedRequest']('getObject', {
			Bucket: process.env.S3_BUCKET_NAME,
			Key: S3Prefix + '/' + req.params[0]
		}).on('httpHeaders', function(statusCode, headers) {
			if(statusCode !== 200) {
				res.send(statusCode);
				return;
			}
			res.set('Content-Length', headers['content-length']);
			res.set('Content-Type', 'application/json');
			this.response.httpResponse.createUnbufferedStream().pipe(res);
		}).send();
	}
});

app.options(/^\/object\/(.+)$/, function(req, res) {
	res.set('Access-Control-Allow-Origin', process.env.USERCONTENT_URL);
	res.set('Access-Control-Allow-Headers', 'X-S3Prefix');
	res.send(200);
});

app.post('/transaction/add', function(req, res) {
	if(userLoggedIn(req)) {
		var transactionId = req.body.transactionId;
		var queue = req.session.userID + ':' + transactionId;
		redis.incrby('transactions:' + queue, req.body.messageCount, function(err, result) {
			if(err) {
				console.error(err);
				res.send(500);
				return;
			}
			if(result === 0) {
				queueTask('transactions', 'commit', {
					queue: queue
				}, new Buffer(0), function(err) {
					if(err) {
						console.error(err);
						res.send(500);
						return;
					}
					res.send(200);
				});
			} else {
				res.send(200);
			}
		});
	} else {
		res.send(403);
		return;
	}
});

app.put(/^\/object\/(.+)$/, function(req, res) {
	if(req.get('X-S3Prefix') || userLoggedIn(req)) {
		var S3Prefix = req.get('X-S3Prefix') || req.session.S3Prefix;
		var authenticated = S3Prefix === req.session.S3Prefix;
		var name = req.params[0];
		var size = req.get('Content-Length');
		var transactionId = req.get('X-Transaction-Id');
		var queue = req.session.userID + ':' + (transactionId || 'oneoff:' + Math.round(Math.random() * Date.now()).toString(16));
		var ACL = req.get('X-ACL');
		var objectAuthkey = req.get('X-Object-Authentication');
		if(!transactionId) {
			redis.incr('transactions:' + queue, function(err) {
				if(err) {
					console.error(err);
					res.send(500);
					return;
				}
			});
		}
		if(!+size) {
			// Reject Content-Length: 0 as a weak effort to prevent data
			// loss. Chrome 38 Linux sends that for PUT requests with a
			// blob under particularly strange network stack conditions.
			// TODO: (additionally) never truncate the body below and
			// reject instead.
			res.send(400);
			return;
		}
		Promise.resolve().then(function() {
			if(!authenticated) {
				return client.one(`
					SELECT 1 FROM objects WHERE "userId" = (SELECT id FROM users WHERE "S3Prefix" = $1) AND name = $2 AND "ACL" = 'public-read-write' AND authkey = $3
				`, [S3Prefix, name, objectAuthkey]);
			}
		}).then(function() {
			var body = [];
			req.on('data', function(data) {
				body.push(data);
			});
			req.on('end', function() {
				queueTask(queue, 'putObject', {
					userID: req.session.userID,
					S3Prefix: S3Prefix,
					authenticated: authenticated,
					name: name,
					size: size,
					ACL: ACL,
					objectAuthkey: objectAuthkey,
				}, Buffer.concat(body), function(err) {
					if(err) {
						console.error(err);
						res.send(500);
						return;
					}
					redis.decr('transactions:' + queue, function(err, result) {
						if(err) {
							console.error(err);
							res.send(500);
							return;
						}
						if(result === 0) {
							queueTask('transactions', 'commit', {
								queue: queue
							}, new Buffer(0), function(err) {
								if(err) {
									console.error(err);
									res.send(500);
									return;
								}
								res.send(200);
							});
						} else {
							res.send(200);
						}
					});
				});
			});
		}, function() {
			res.statusMessage = 'Not allowed. Ask for a new share link?';
			res.send(403);
			return;
		});
	} else {
		res.send(403);
		return;
	}
});

if(process.env.MIN_CORE_VERSION <= 1) {
	app.get(/^\/sign_s3_copy_(.+)$/, function(req, res) {
		if(!userLoggedIn(req)) {
			res.send(403);
			return;
		}
		
		var object_name = req.query.s3_object_name;
		var mime_type = req.query.s3_object_type;
		
		var copy_source = req.params[0];

		if(req.query.s3_object_name.substr(0, 17) !== req.session.S3Prefix + '/') {
			res.send(403);
			return;
		}
		
		var name = object_name.split('/')[1];
		var copy_source_name = copy_source.split('/')[1];
		client.query(`
			INSERT INTO objects ("userId", name, size) VALUES ($1, $2, (SELECT size FROM objects WHERE "userId" = $3 AND name = $4))
			ON CONFLICT ("userId", name) DO UPDATE
			SET size = excluded.size
		`, [req.session.userID, name, req.session.userID, copy_source_name]).then(function() {
			var now = new Date();
			var expires = Math.ceil((now.getTime() + 600000)/1000); // 10 minutes from now
			var amz_headers = 'x-amz-acl:public-read';
			amz_headers += '\nx-amz-copy-source:/' + process.env.S3_BUCKET_NAME + '/' + copy_source;

			var put_request = 'PUT\n\n'+mime_type+'\n'+expires+'\n'+amz_headers+'\n/'+process.env.S3_BUCKET_NAME+'/'+object_name;

			var signature = crypto.createHmac('sha1', new Buffer(process.env.AWS_SECRET_ACCESS_KEY, 'ascii')).update(put_request).digest('base64');
			signature = encodeURIComponent(signature.trim());
			signature = signature.replace('%2B','+');

			var url = 'https://'+process.env.S3_BUCKET_NAME+'.s3.amazonaws.com/'+object_name;

			var credentials = {
				req: put_request,
				signed_request: url+'?AWSAccessKeyId='+process.env.AWS_ACCESS_KEY_ID+'&Expires='+expires+'&Signature='+signature,
				url: url
			};
			res.send(JSON.stringify(credentials));
		}, function() {
			console.error(err);
			res.send(500);
		});
	});
	
	app.get(/^\/sign_s3_post_(\d+)$/, function(req, res) {
		if(!userLoggedIn(req)) {
			res.send(403);
			return;
		}
		
		var object_name = req.query.s3_object_name;
		var mime_type = req.query.s3_object_type;
		
		var object_size = req.params[0];

		if(req.query.s3_object_name.substr(0, 17) !== req.session.S3Prefix + '/') {
			res.send(403);
			return;
		}
		
		var name = object_name.split('/')[1];
		client.query(`
			INSERT INTO objects ("userId", name, size) VALUES ($1, $2, $3)
			ON CONFLICT ("userId", name) DO UPDATE
			SET size = excluded.size
		`, [req.session.userID, name, object_size]).then(function() {
			var now = new Date();
			var isoNow = now.toISOString().replace(/-|:|\.\d+/g, '');
			var date = now.getUTCFullYear() + ('00' + now.getUTCMonth()).substr(-2) + ('00' + now.getUTCDate()).substr(-2);
			var expires = new Date(now.getTime() + 600000); // 10 minutes from now

			var credential = process.env.AWS_ACCESS_KEY_ID + '/' + date + '/' + process.env.AWS_REGION + '/s3/aws4_request';
			var policy = new Buffer(JSON.stringify({
				expiration: expires.toISOString(),
				conditions: [
					{bucket: process.env.S3_BUCKET_NAME},
					{key: object_name},
					{acl: 'public-read'},
					['content-length-range', object_size, object_size],
					{'x-amz-algorithm': 'AWS4-HMAC-SHA256'},
					{'x-amz-credential': credential},
					{'x-amz-date': isoNow}
				]
			})).toString('base64');
			
			var dateKey = crypto.createHmac('sha256', new Buffer('AWS4' + process.env.AWS_SECRET_ACCESS_KEY, 'ascii')).update(date).digest();
			var dateRegionKey = crypto.createHmac('sha256', dateKey).update(process.env.AWS_REGION).digest();
			var dateRegionServiceKey = crypto.createHmac('sha256', dateRegionKey).update('s3').digest();
			var signingKey = crypto.createHmac('sha256', dateRegionServiceKey).update('aws4_request').digest();

			var signature = crypto.createHmac('sha256', signingKey).update(policy).digest('hex');

			var url = 'https://'+process.env.S3_BUCKET_NAME+'.s3.amazonaws.com/';

			var credentials = {
				fields: {
					key: object_name,
					acl: 'public-read',
					policy: policy,
					'x-amz-algorithm': 'AWS4-HMAC-SHA256',
					'x-amz-credential': credential,
					'x-amz-date': isoNow,
					'x-amz-signature': signature
				},
				signed_request: url,
				url: url + object_name
			};
			res.send(JSON.stringify(credentials));
		}, function() {
			console.error(err);
			res.send(500);
		});
	});
}

app.post('/register', function(req, res) {
	if(!req.session.ishuman) {
		res.send(403);
		return;
	}
	var id = guid().replace(/-/g, '').toUpperCase();
	var username = req.body.username;
	var salt = req.body.salt;
	var authkey = req.body.authkey;
	var S3Prefix = crypto.createHmac('sha256', new Buffer(authkey, 'hex')).update(username).digest('hex').substr(0, 16);
	var password_backup_key = req.body.password_backup_key;
	var email = req.body.email;
	var referrer = req.body.referrer;
	client.query('INSERT INTO users (id, username, salt, authkey, "S3Prefix", account_version, tier, quota, password_backup_key, email, created, referrer) VALUES ($1, $2, $3, $4, $5, 3, $6, $7, $8, $9, $10, $11)', [id, username, salt, authkey, S3Prefix, process.env.DEFAULT_TIER, process.env.DEFAULT_QUOTA, password_backup_key, email, Math.floor(Date.now() / 1000), referrer]).then(function() {
		req.session.username = username;
		login(req, res, authkey, function() {
			res.send(200);
		});
	}, function(err) {
		console.error(err);
		if(err.detail && err.detail.match(/Key \(username\)=\(.+\) already exists./)) {
			res.send(409, 'User exists.');
		} else {
			res.send(500);
		}
	});
});

app.get('/messages', function(req, res) {
	res.send([]);
});

var server = app.listen(process.env.PORT || 8080, function() {
	console.log('Listening on port %d', server.address().port);
});

var io = require('socket.io')(server);

io.on('connection', function(socket) {
	socket.emit('hello', '/push/' + socket.id + '/');
});

app.use('/push/', bodyParser.urlencoded({type: [], extended: false, limit: 100, parameterLimit: 1}));

app.put('/push/:id/', function(req, res) {
	console.log(req.body);
	io.to(req.params.id).emit('push', {
		registrationId: req.query.registrationId,
		version: parseInt(req.body.version, 10)
	});
	res.send(200);
});

app.get('/plans', function(req, res) {
	return https.get('https://sites.fastspring.com/airbornos/api/price?product_1_path=/knowledgeworker&product_2_path=/businessworker&user_x_forwarded_for=' + encodeURIComponent(req.get('X-Forwarded-For').split(',')[0]) + '&user_accept_language=' + encodeURIComponent(req.get('Accept-Language')), function(response) { // &user_remote_addr=' + encodeURIComponent(req.connection.remoteAddress) + '
		var body = '';
		response.on('data', function(data) {
			body += data;
		});
		response.on('end', function() {
			var prices = {};
			body.split('\n').forEach(function(line) {
				var pair = line.split('=');
				prices[pair[0]] = pair[1];
			});
			fs.readFile('plans.mustache', 'utf8', function(err, contents) {
				res.set('Cache-control', 's-maxage=0');
				res.send(200, Mustache.render(contents, {
					FORKME_URL: process.env.FORKME_URL,
					FASTSPRING_URL: process.env.FASTSPRING_URL,
					userId: req.session.userID,
					username: req.session.username,
					subscription: req.session.subscription,
					knowledgeWorker: req.session.tier === 5,
					businessWorker: req.session.tier === 10,
					knowledgeWorkerPrice: (prices.product_1_unit_value / 3).toLocaleString(prices.user_language, {style: 'currency', currency: prices.user_currency}),
					businessWorkerPrice: parseFloat(prices.product_2_unit_value).toLocaleString(prices.user_language, {style: 'currency', currency: prices.user_currency}),
				}, {
					menu: menu_html,
				}));
			});
		});
	});
});
app.post(/^\/notify\/(activated|changed)\/$/, function(req, res) {
	if(crypto.createHash('md5').update(req.get('X-Security-Data') + process.env.FASTSPRING_PRIVATE_KEY, 'ascii').digest('hex') !== req.get('X-Security-Hash')) {
		res.send(403);
		return;
	}
	client.query('UPDATE users SET tier = $2, quota = $3, subscription = $4 WHERE id = $1', [req.body.userId, req.body.tier, req.body.quota, req.body.subscription]).then(function() {
		res.send(200);
	}).then(null, function(err) {
		console.error(err);
		res.send(500);
	});
});
app.post('/notify/deactivated/', function(req, res) {
	if(crypto.createHash('md5').update(req.get('X-Security-Data') + process.env.FASTSPRING_PRIVATE_KEY, 'ascii').digest('hex') !== req.get('X-Security-Hash')) {
		res.send(403);
		return;
	}
	client.query('UPDATE users SET tier = $2, quota = $3, subscription = $4 WHERE id = $1', [req.body.userId, process.env.DEFAULT_TIER, process.env.DEFAULT_QUOTA, '']).then(function() {
		res.send(200);
	}).then(null, function(err) {
		console.error(err);
		res.send(500);
	});
});

app.get('/v2/live/Apps/', function(req, res) {
	res.send(`strut/: {}
firetext/: {}
`);
});
app.get('/v2/live/Documents/Documents/Welcome.html', function(req, res) {
	res.sendFile('Welcome.html', {root: __dirname});
});

var update = {};
['/current-id', '/current', '/v2/current-id', '/v2/current'].forEach(function(path) {
	update[path] = request({
		uri: process.env.UPDATE_URL + path,
		resolveWithFullResponse: true,
		encoding: null, // Buffer
	});
});
var live = {};
['/current', '/v2/current'].forEach(function(path) {
	live[path.replace('current', 'live')] = update[path].then(function(response) {
		return JSZip.loadAsync(response.body);
	});
});
app.get(/^\/(?:v2\/)?current(?:-id)?$/, function(req, res) {
	update[req.path].then(function(response) {
		res.set('Content-Type', response.headers['content-type']);
		res.set('Content-Length', response.headers['content-length']);
		res.set('X-GitHub-Commit', response.headers['x-github-commit']);
		res.send(200, response.body);
	});
});
app.get(/^(\/(?:v2\/)?live)\/(.*)$/, function(req, res) {
	var path = req.params[1];
	live[req.params[0]].then(function(zip) {
		var file = zip.file(path);
		if(file) {
			res.contentType(path.split('.').pop());
			file.nodeStream().pipe(res);
		} else {
			res.send(404);
		}
	});
});

app.get('/firetext/location', function(req, res) {
	geoip2.lookupSimple(req.get('X-Forwarded-For').split(',')[0], function(err, result) {
		if(err) {
			console.error(err);
			res.send(500);
			return;
		}
		res.set('Access-Control-Allow-Origin', '*');
		res.send(200, {
			country: result.country,
		});
	});
});

app.use('/firetext', function(req, res) {
	req.pipe(http.request({
		method: req.method,
		hostname: process.env.FIRETEXT_SERVER_HOSTNAME,
		path: req.url,
	}, function(firetext) {
		res.statusCode = firetext.statusCode;
		res.set('Content-Type', firetext.headers['content-type']);
		res.set('Access-Control-Allow-Origin', firetext.headers['access-control-allow-origin']);
		firetext.pipe(res);
	}).on('error', function(err) {
		console.error(err);
		res.send(500);
	}));
});

app.get('/docs/:id', function(req, res) {
	fs.readFile(req.path.substr(1) + '.md', 'utf8', function(err, contents) {
		if(err) {
			console.error(err);
			res.send(500);
			return;
		}
		fs.readFile('docs/docs.mustache', 'utf8', function(err, docs) {
			res.send(200, Mustache.render(docs, {
				FORKME_URL: process.env.FORKME_URL,
				title: contents.match(/^# (.*)$/m)[1],
				contents: marked(contents),
			}, {
				menu: menu_html,
			}));
		});
	});
});
app.get('/docs/images/:image', function(req, res) {
	res.sendfile(req.path.substr(1));
});

app.get('/terms', function(req, res) {
	fs.readFile('terms.md', 'utf8', function(err, contents) {
		fs.readFile('terms.mustache', 'utf8', function(err, terms) {
			res.send(200, Mustache.render(terms, {
				FORKME_URL: process.env.FORKME_URL,
				contents: marked(contents),
			}, {
				menu: menu_html,
			}));
		});
	});
});

app.get('/run', function(req, res) {
	if(userLoggedIn(req)) {
		res.redirect('/app');
	} else {
		res.redirect('/demo');
	}
});

app.get('/pub', function(req, res) {
	res.redirect(process.env.USERCONTENT_URL + req.path);
});

app.get('/feedback', function(req, res) {
	res.redirect(process.env.FEEDBACK_URL);
});

app.get('/google-drive-import', function(req, res) {
	res.redirect(process.env.GOOGLE_DRIVE_IMPORT_URL);
});


function login(req, res, authkey, cont) {
	client.one('SELECT id, authkey, "S3Prefix", account_version, tier, subscription FROM users WHERE username = $1', [req.session.username]).then(function(user) {
		if(user.authkey === authkey) {
			res.set('Cache-control', 's-maxage=0');
			req.session.userID = user.id;
			req.session.S3Prefix = user.S3Prefix;
			req.session.tier = user.tier;
			req.session.subscription = user.subscription;
			res.cookie('account_info', {
				S3Prefix: user.S3Prefix,
				account_version: user.account_version,
				tier: user.tier
			});
			cont();
		} else {
			res.send(401);
		}
	}, function(err) {
		console.error(err);
		res.send(500);
	});
}

function userLoggedIn(req) {
	return req.session.userID !== undefined;
}

function guid() {
	var d = new Date().getTime();
	var uuid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
		var r = (d + Math.random()*16)%16 | 0;
		d = Math.floor(d/16);
		return (c=='x' ? r : (r&0x7|0x8)).toString(16);
	});
	return uuid;
}


/********* Collaboration *********/

process.on('SIGTERM', server.close.bind(server)); // Give `setTimeout`s time to execute

var ftio = require('socket.io')(server, {
	path: '/ft-socket.io'
});

ftio.use(function(socket, next) {
	session(socket.request, {}, next);
});

function updateRooms(socket, data) {
	if(socket.path !== data.path) {
		if(socket.path) { socket.leave(socket.path); }
		socket.join(data.path);
		socket.path = data.path;
	}
}

ftio.on('connection', function(socket) {
	socket.on('open', function(data) {
		updateRooms(socket, data);
		socket.to(data.path).emit('open');
	});
	socket.on('edit', function(data) {
		updateRooms(socket, data)
		ftio.to(data.path).emit('edit', data);
		setTimeout(function() {
			ftio.to(data.path).emit('lock-end', {
				id: data.id
			});
		}, data.len);
	});
});



/********* visualCaptcha *********/

// Define routes functions
// Fetches and streams an audio file
function _getAudio( req, res, next ) {
	res.set('Cache-control', 's-maxage=0');
	
	// Default file type is mp3, but we need to support ogg as well
	if ( req.params.type !== 'ogg' ) {
		req.params.type = 'mp3';
	}
	
	if ( ! visualCaptcha ) {
		visualCaptcha = require( 'visualcaptcha' )( req.session, req.query.namespace );
	}

	visualCaptcha.streamAudio( res, req.params.type );
};

// Fetches and streams an image file
function _getImage( req, res, next ) {
	res.set('Cache-control', 's-maxage=0');
	
	var isRetina = false;

	// Default is non-retina
	if ( req.query.retina ) {
		isRetina = true;
	}
	
	if ( ! visualCaptcha ) {
		visualCaptcha = require( 'visualcaptcha' )( req.session, req.query.namespace );
	}

	visualCaptcha.streamImage( req.params.index, res, isRetina );
};

// Start and refresh captcha options
function _startRoute( req, res, next ) {
	res.set('Cache-control', 's-maxage=0');

	// After initializing visualCaptcha, we only need to generate new options
	if ( ! visualCaptcha ) {
		visualCaptcha = require( 'visualcaptcha' )( req.session, req.query.namespace );
	}
	visualCaptcha.generate( req.params.howmany );

	// We have to send the frontend data to use on POST.
	res.send( 200, visualCaptcha.getFrontendData() );
};

// Try to validate the captcha
// We need to make sure we generate new options after trying to validate, to avoid abuse
function _trySubmission( req, res, next ) {
	res.set('Cache-control', 's-maxage=0');
	
	var namespace = req.query.namespace,
		frontendData,
		queryParams = [],
		imageAnswer,
		audioAnswer,
		responseStatus,
		responseObject;
	
	if ( ! visualCaptcha ) {
		visualCaptcha = require( 'visualcaptcha' )( req.session, req.query.namespace );
	}
	
	frontendData = visualCaptcha.getFrontendData();

	// Add namespace to query params, if present
	if ( namespace && namespace.length !== 0 ) {
		queryParams.push( 'namespace=' + namespace );
	}
	
	// If an image field name was submitted, try to validate it
	if ( ( imageAnswer = req.body[ frontendData.imageFieldName ] ) ) {
		if ( visualCaptcha.validateImage( imageAnswer ) ) {
			queryParams.push( 'status=validImage' );

			responseStatus = 200;
		} else {
			queryParams.push( 'status=failedImage' );

			responseStatus = 403;
		}
	} else if ( ( audioAnswer = req.body[ frontendData.audioFieldName ] ) ) {
		// We set lowercase to allow case-insensitivity, but it's actually optional
		if ( visualCaptcha.validateAudio( audioAnswer.toLowerCase() ) ) {
			queryParams.push( 'status=validAudio' );

			responseStatus = 200;
		} else {
			queryParams.push( 'status=failedAudio' );

			responseStatus = 403;
		}
	} else {
		queryParams.push( 'status=failedPost' );

		responseStatus = 500;
	}

	if(responseStatus === 403) {
		newrelic.setIgnoreTransaction(true);
		setTimeout(function() {
			res.send( responseStatus );
		}, 2000);
	} else {
		req.session.ishuman = true;
		res.send( responseStatus );
	}
};

// Routes definition


app.post( '/captcha/try', _trySubmission );

// @param type is optional and defaults to 'mp3', but can also be 'ogg'
app.get( '/captcha/audio', _getAudio );
app.get( '/captcha/audio/:type', _getAudio );

// @param index is required, the index of the image you wish to get
app.get( '/captcha/image/:index', _getImage );

// @param howmany is required, the number of images to generate
app.get( '/captcha/start/:howmany', _startRoute );


/********* Error handling *********/

app.use(function(err, req, res, next) {
	console.error(err);
	res.send(500);
});
