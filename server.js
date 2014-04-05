var fs = require('fs');
var path = require('path');

var express = require('express');
var app = express();

app.use(express.cookieParser());
app.use(express.cookieSession({secret: 'secret'})); // TODO: Hide secret

app.get('/', function(req, res) {
	res.sendfile('bootstrap.html');
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
app.get('/init.js', function(req, res) {
	res.sendfile('init.js');
});

app.get('/object/:id', function(req, res) {
	if(!userLoggedIn(req)) {
		res.send(403);
		return;
	}
	var path = objPath(req);
	res.attachment(path);
	res.sendfile(path);
});
app.put('/object/:id', function(req, res) {
	if(!userLoggedIn(req)) {
		res.send(403);
		return;
	}
	var path = objPath(req);
	var dest = fs.createWriteStream(path, {
		flags: 'wx'
	});
	dest.on('error', function(err) {
		if(err.code === 'EEXIST') {
			res.send(412);
		} else {
			console.error(err.stack);
			res.send(500);
		}
	});
	req.pipe(dest);
	req.on('end', function() {
		res.send(200);
	});
});

var server = app.listen(process.env.PORT || 8080, function() {
    console.log('Listening on port %d', server.address().port);
});

function objPath(req) {
	return path.join(__dirname, 'data', 'users', req.session.username || 'daniel', 'objects', req.route.params.id.substr(0, 2), req.route.params.id.substr(2));
}

function userLoggedIn(req) {
	return true;
	return req.session.username !== undefined;
}