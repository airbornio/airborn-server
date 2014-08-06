function GET(url, callback) {
	var req = new XMLHttpRequest();
	req.onreadystatechange = function() {
		if(req.readyState === 4 && req.status === 200) {
			callback(req.responseText);
		}
	};
	req.open('GET', url);
	req.send(null);
}

function POST(url, data, success, error) {
	var req = new XMLHttpRequest();
	req.onreadystatechange = function() {
		if(req.readyState === 4)
			if(req.status === 200) {
				success(req.responseText);
			} else {
				error(req);
			}
	};
	req.open('POST', url);
	req.setRequestHeader('Content-Type', 'application/json');
	req.send(JSON.stringify(data));
}

var lang = {};
GET('lang.json', function(response) {
	var strings = lang = JSON.parse(response);
	document.getElementById('username-label').textContent = strings.username;
	document.getElementById('password-label').textContent = strings.password;
	document.getElementById('password-again-label').textContent = strings['password-again'];
	document.getElementById('captcha-label').textContent = strings.captcha;
	document.getElementById('register').value = strings.register;
});

var captcha;
document.addEventListener('DOMContentLoaded', function() {
	captcha = visualCaptcha('captcha', {
		numberOfImages: 5,
		imgPath: '/3rdparty/visualcaptcha/img/',
		captcha: {
			url: '/captcha',
			callbacks: {
				loading: function(captcha){
					console.log('I am loading.', captcha);
				},
				loaded: function(captcha){
					console.log('I am loaded.', captcha);
				}
			}
		}
	});
});

document.getElementById('container').addEventListener('submit', function(evt) {
	evt.preventDefault();
	if(!captcha.getCaptchaData().valid) {
		alert(lang.nocaptcha);
		return;
	}
	var register = document.getElementById('register');
	register.disabled = true;
	register.value = lang.validating;
	var data = {};
	Array.prototype.forEach.call(document.getElementById('captcha').getElementsByTagName('input'), function(input) {
		data[input.name] = input.value;
	});
	var username = window.username = document.getElementById('username').value;
	var password = window.password = document.getElementById('password').value;
	POST('/captcha/try', data, function() {
		register.value = lang.registering;
		try {
			var salt = sjcl.random.randomWords(2);
			var files_key = window.files_key = sjcl.random.randomWords(8);
		} catch(e) {
			alert(lang.error);
			throw e;
		}
		var key = sjcl.misc.pbkdf2(password, salt, 1000);
		var private_key = key.slice(128/32); // Second half
		var shared_key = key.slice(0, 128/32); // First half
		var private_hmac = window.private_hmac = new sjcl.misc.hmac(private_key);
		var shared_hmac = window.shared_hmac = new sjcl.misc.hmac(shared_key);
		var authkey = sjcl.codec.hex.fromBits(shared_key).toUpperCase();
		
		POST('/register', {
			username: username,
			salt: sjcl.codec.hex.fromBits(salt).toUpperCase(),
			authkey: authkey
		}, function(response) {
			register.value = lang.uploading;
			JSZipUtils.getBinaryContent('http://airborn-update-stage.herokuapp.com/current', function(err, data) {
				if(err) {
					register.disabled = false;
					register.value = lang.register;
					alert(lang.error);
					return;
				}
				
				var zip = new JSZip(data);

				var getFile = function(file, options, callback) {
					console.log([].slice.call(arguments));
					if(window.getFileCache[file]) {
						return window.getFile(file, options, callback);
					}
					if(typeof options === 'function') {
						callback = options;
						options = {};
					}
					if(file.substr(0, 6) === '/Core/' && file.substr(-1) !== '/' && zip.files['airborn/' + file.substr(6)]) {
						callback(zip.files['airborn/' + file.substr(6)].asText());
					} else {
						callback(null);
					}
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
						putFile(target + path.replace(/^airborn\//, ''), {codec: 'arrayBuffer'}, file.asArrayBuffer(), function() {
							uploaded++;
							if(uploaded === total) cont();
						});
					}
				});
				total++;
				putFile('/key', sjcl.codec.hex.fromBits(files_key).toUpperCase(), function() {
					uploaded++;
					if(uploaded === total) cont();
				});
				function cont() {
					
				}
			});
		}, function(req) {
			register.disabled = false;
			register.value = lang.register;
			alert(lang.error);
		});
	}, function(req) {
		register.disabled = false;
		register.value = lang.register;
		if(req.status === 403) {
			alert(lang.wrong);
			captcha.refresh();
		} else {
			alert(lang.error);
		}
	});
});