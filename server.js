require('newrelic');

var fs = require('fs');
var path = require('path');
var crypto = require('crypto');

var express = require('express');
var app = express();

var pg = require('pg.js');

var AWS = require('aws-sdk');
var s3 = new AWS.S3();

app.use(express.cookieParser());
app.use(express.cookieSession({secret: 'secret'})); // TODO: Hide secret

app.get('/', function(req, res) {
	res.sendfile('bootstrap.html');
});
app.get('/sjcl.js', function(req, res) {
	res.sendfile('sjcl.js');
});
app.get('/bootstrap.js', function(req, res) {
	res.sendfile('bootstrap.js');
});
app.get('/lang.json', function(req, res) {
	res.sendfile('lang.json');
});
app.get('/bootstrap.css', function(req, res) {
	res.sendfile('bootstrap.css');
});
app.get('/content.html', function(req, res) {
	res.sendfile('content.html');
});
app.get('/content.css', function(req, res) {
	res.sendfile('content.css');
});

app.get('/user/:username/salt', function(req, res) {
	var username = req.param('username');
	req.session.username = username;
	pg.connect(process.env.DATABASE_URL, function(err, client, done) {
		if(err) {
			console.error(err);
			res.send(500);
			return;
		}
		client.query('SELECT salt FROM users WHERE username = $1', [username], function(err, result) {
			done();
			if(err || !result.rows[0]) {
				console.error(err);
				res.send(500);
				return;
			}
			res.send(200, result.rows[0].salt);
		});
	});
});

app.get(/^\/object\/(.+)$/, function(req, res) {
	var authkey = req.get('X-Authentication');
	if(authkey) {
		login(req, res, authkey, cont);
	} else if(!userLoggedIn(req)) {
		res.send(403);
		return;
	} else {
		cont();
	}
	function cont() {
		var stream = s3.getObject({Bucket: 'laskya-cloud', Key: req.route.params[0]}).createReadStream();
		stream.pipe(res);
		stream.on('error', function(err) {
			console.error(err);
			res.send(err.statusCode);
		});
	}
});

app.get(/^\/sign_s3_(put|copy_(.+))$/, function(req, res) {
	if(!userLoggedIn(req)) {
		res.send(403);
		return;
	}

	var method = req.route.params[0];
	
	var object_name = req.query.s3_object_name;
	var mime_type = req.query.s3_object_type;

	var now = new Date();
	var expires = Math.ceil((now.getTime() + 600000)/1000); // 10 minutes from now
	var amz_headers = 'x-amz-acl:public-read';
	if(method !== 'put') amz_headers += '\nx-amz-copy-source:/' + process.env.S3_BUCKET_NAME + '/' + req.route.params[1];

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
	res.write(JSON.stringify(credentials));
	res.end();
});

var server = app.listen(process.env.PORT || 8080, function() {
	console.log('Listening on port %d', server.address().port);
});

function login(req, res, authkey, cont) {
	pg.connect(process.env.DATABASE_URL, function(err, client, done) {
		if(err) {
			console.error(err);
			res.send(500);
			return;
		}
		client.query('SELECT ID, authkey FROM users WHERE username = $1', [req.session.username], function(err, result) {
			done();
			if(err || !result.rows[0]) {
				console.error(err);
				res.send(500);
				return;
			}
			if(result.rows[0].authkey === authkey) {
				req.session.userID = result.rows[0].id;
				delete req.session.username;
				cont();
			} else {
				res.send(401);
			}
		});
	});
}

function userLoggedIn(req) {
	return req.session.userID !== undefined;
}

/////////////// Code to get a user's S3 file prefix ///////////////
//	pg.connect(process.env.DATABASE_URL, function(err, client, done) {
//		if(err) {
//			console.error(err);
//			res.send(500);
//			return;
//		}
//		client.query('SELECT username, authkey FROM users WHERE ID = $1', [req.session.userID], function(err, result) {
//			done();
//			if(err || !result.rows[0]) {
//				console.error(err);
//				res.send(500);
//				return;
//			}
//			console.log(crypto.createHmac('sha256', new Buffer(result.rows[0].authkey, 'hex')).update(result.rows[0].username).digest('hex').substr(0, 16));
//		});
//	});
///////////////////////////////////////////////////////////////////