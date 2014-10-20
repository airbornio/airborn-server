function GET(url, callback, err, authkey) {
	var req = new XMLHttpRequest();
	req.onreadystatechange = function() {
		if(req.readyState === 4) {
			if(req.status === 200) {
				callback(req.responseText);
			} else {
				if(err) err(req);
			}
		}
	};
	req.open('GET', url);
	if(authkey) req.setRequestHeader('X-Authentication', authkey);
	req.send(null);
}

function login(username, password, callback) {
	GET('user/' + username + '/salt', function(salt) {
		var done = 0;
		var key = sjcl.misc.pbkdf2(password, sjcl.codec.hex.toBits(salt), 1000);
		var private_key = key.slice(128/32); // Second half
		var shared_key = key.slice(0, 128/32); // First half
		var private_hmac = window.private_hmac = new sjcl.misc.hmac(private_key);
		var files_hmac;
		var authkey = sjcl.codec.hex.fromBits(shared_key).toUpperCase();
		GET('object/' + sjcl.codec.hex.fromBits(private_hmac.mac('/key')), function(response) {
			try {
				files_key = window.files_key = sjcl.codec.hex.toBits(sjcl.decrypt(private_key, response));
			} catch(e) {
				files_key = window.files_key = sjcl.codec.hex.toBits(sjcl.decrypt(password, response));
			}
			window.account_info = JSON.parse(decodeURIComponent(document.cookie.split('=')[1]).match(/\{.*\}/)[0]);
			if(++done === 2) callback();
		}, err, authkey);
		GET('object/' + sjcl.codec.hex.fromBits(private_hmac.mac('/hmac')), function(response) {
			try {
				var hmac_bits = sjcl.codec.hex.toBits(sjcl.decrypt(private_key, response));
			} catch(e) {
				var hmac_bits = sjcl.codec.hex.toBits(sjcl.decrypt(password, response));
			}
			files_hmac = window.files_hmac = new sjcl.misc.hmac(hmac_bits);
			if(++done === 2) callback();
		}, undefined, authkey);
		function err(req) {
			if(req.status === 401) {
				alert(lang.wrongpass);
			} else {
				alert(lang.error);
			}
		}
	}, function(req) {
		if(req.status === 404) {
			alert(lang.wronguser);
		} else {
			alert(lang.error);
		}
	});
}

var lang = {};
GET('lang.json', function(response) {
	var strings = lang = JSON.parse(response);
	document.getElementById('username').placeholder = strings.username;
	document.getElementById('password').placeholder = strings.password;
	document.getElementById('repair').value = strings.repair;
	document.getElementById('contact').textContent = strings.contact;
	document.getElementById('explanation').textContent = strings.repairexplanation;
});

document.getElementById('container').addEventListener('submit', function(evt) {
	evt.preventDefault();
	
	document.getElementById('repair').disabled = true;
	document.getElementById('repair').value = lang.repairing;
	
	login(document.getElementById('username').value, document.getElementById('password').value, function() {
		JSZipUtils.getBinaryContent('http://airborn-update-stage.herokuapp.com/current', function(err, data) {
			if(err) {
				document.getElementById('repair').disabled = false;
				document.getElementById('repair').value = lang.repair;
				alert(lang.error);
				return;
			}
			
			var zip = new JSZip(data);

			var getFile = function(file, options, callback) {
				console.log([].slice.call(arguments));
				if(file.substr(0, 6) === '/Core/' && file.substr(-1) !== '/' && zip.files['airborn/' + file.substr(6)]) {
					if(typeof options === 'function') {
						callback = options;
						options = {};
					}
					callback(zip.files['airborn/' + file.substr(6)].asText());
					return;
				}
				return window.getFile(file, options, callback);
			};
			var openWindow = function() {};
			eval(zip.files['airborn/core.js'].asText());

			var keys = Object.keys(zip.folder('airborn').files);
			var uploaded = 0;
			var total = 0;
			var target = '/Core/';
			
			keys.forEach(function(path) {
				var file = zip.files[path];
				if(!file.options.dir) {
					total++;
					putFile(
						target + path.replace(/^airborn\//, ''),
						{codec: 'arrayBuffer'},
						file.asArrayBuffer(),
						{from: 'origin'}, // Don't merge because the
										  // merge might've been the
										  // problem in the first place.
						function() {
							uploaded++;
							if(uploaded === total) cont();
						}
					);
				}
			});
			
			function cont() {
				corsReq('http://marketplace-dev.airborn.io/api/v1/apps/app/marketplace/', function() {
					installPackage(this.response.manifest_url, {categories: this.response.categories}, function() {
						document.getElementById('container').innerHTML = lang.repairdone.replace('{email}', '<a href="mailto:support@airborn.io">support@airborn.io</a>') + ' ' + '<a href="/">' + lang.login + '</a>';
					});
				}, 'json');
			}
		});
	});
});