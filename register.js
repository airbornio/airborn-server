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
	document.getElementById('download-creds-explanation').innerHTML = strings['download-creds-explanation'].replace('\n', '<br>');
	document.getElementById('download-creds').value = strings['download-creds'];
	document.getElementById('email-label').textContent = strings.email;
	document.getElementById('double-check-email').innerHTML = strings['double-check-email'].replace('\n', '<br>');
	document.getElementById('notify-of-updates-label').textContent = strings['notify-of-updates'];
	document.getElementById('agree-terms-label').innerHTML = strings['agree-terms'].replace('{terms}', '<a target="_blank" href="terms">' + strings.terms + '</a>');
	document.getElementById('ready').textContent = strings.ready;
	document.getElementById('current-step').textContent = strings['current-step'];
	document.getElementById('register').value = strings.register;
});

var captcha;
document.addEventListener('DOMContentLoaded', function() {
	captcha = visualCaptcha('captcha', {
		numberOfImages: 5,
		imgPath: '/3rdparty/visualcaptcha/img/',
		captcha: {
			url: '/captcha'
		}
	});
	this.addEventListener('click', function(evt) {
		var elm = evt.target;
		if(evt.target.tagName === 'IMG') {
			elm = elm.parentElement;
		}
		if(elm.classList.contains('img')) {
			updateCurrentStep();
		} else if(elm.classList.contains('visualCaptcha-refresh-button')) {
			document.getElementById('ready').style.display = 'none';
		} else if(elm.tagName === 'INPUT' && elm.type === 'checkbox') {
			updateCurrentStep();
		}
	});
	this.addEventListener('keypress', function(evt) {
		var elm = evt.target;
		if(evt.target.tagName === 'IMG') {
			elm = elm.parentElement;
		}
		if((elm.classList.contains('img') || elm.classList.contains('visualCaptcha-refresh-button') || elm.classList.contains('visualCaptcha-accessibility-button')) &&
		   (evt.which === 13 || evt.which === 32)) {
			elm.click();
		}
	});
	function debounce(fn, time, obj) {
		if(obj.timeout) clearTimeout(obj.timeout);
		obj.timeout = setTimeout(function() {
			delete obj.timeout;
			fn();
		}, time);
	}
	var debounceObj = {};
	this.addEventListener('keyup', function(evt) {
		debounce(updateCurrentStep, 500, debounceObj);
	});
	document.getElementById('download-creds').addEventListener('click', function() {
		var username = document.getElementById('username').value;
		var password = document.getElementById('password').value;
		var password_backup_key = window.password_backup_key = sjcl.random.randomWords(8);
		var password_backup = sjcl.encrypt(password_backup_key, password);
		saveAs(new Blob([username, '\n', password_backup], {type: 'text/plain'}), 'airbornos.txt');
		window.creds_backupped = JSON.stringify([username, password]);
		updateCurrentStep();
	});
	function updateCurrentStep() {
		document.getElementById('ready').style.display = 'none';
		document.getElementById('error').style.display = 'none';
		document.getElementById('current-step').style.display = 'none';
		document.getElementById('download-creds').disabled = true;
		document.getElementById('register').disabled = true;
		if(document.getElementById('username').value) {
			GET('/user/' + document.getElementById('username').value + '/exists', function(response) {
				var step, error;
				if(response === 'true') {
					step = 0;
					error = lang.taken;
				} else {
					var current = currentStep();
					step = current[0];
					error = current[1];
				}
				if(step === 'done') {
					document.getElementById('ready').style.display = 'inline-block';
				} else if(step !== 7) {
					var td = document.getElementById('container').getElementsByTagName('tr')[step].firstChild
					td.insertBefore(document.getElementById('current-step'), td.firstChild);
					document.getElementById('current-step').style.display = 'block';
				}
				if(step === 3) {
					document.getElementById('download-creds').disabled = false;
				}
				if(step === 'done') {
					document.getElementById('register').disabled = false;
				}
				if(error === lang.taken || error === lang.diffpasswords) {
					document.getElementById('error').textContent = error;
					document.getElementById('error').style.display = 'inline-block';
				}
			});
		}
	}
});

function currentStep() {
	if(!document.getElementById('username').value) {
		return [0, lang.nofield];
	}
	if(!document.getElementById('password').value) {
		return [1, lang.nofield];
	}
	if(!document.getElementById('password-again').value) {
		return [2, lang.nofield];
	}
	if(document.getElementById('password').value !== document.getElementById('password-again').value) {
		return [2, lang.diffpasswords];
	}
	if(window.creds_backupped !== JSON.stringify([document.getElementById('username').value, document.getElementById('password').value])) {
		return [3, lang.nodownloadcreds];
	}
	if(!document.getElementById('email').value) {
		return [4, lang.nofield];
	}
	if(!document.getElementById('agree-terms').checked) {
		return [7, lang.noterms];
	}
	if(!captcha.getCaptchaData().valid) {
		return [8, lang.nocaptcha];
	}
	return ['done'];
}

document.getElementById('container').addEventListener('submit', function(evt) {
	evt.preventDefault();
	var error = currentStep()[1];
	if(error) {
		alert(error);
		return;
	}
	document.getElementById('ready').style.display = 'none';
	var register = document.getElementById('register');
	register.disabled = true;
	register.value = lang.validating;
	var data = {};
	Array.prototype.forEach.call(document.getElementById('captcha').getElementsByTagName('input'), function(input) {
		data[input.name] = input.value;
	});
	var username = window.username = document.getElementById('username').value;
	var password = window.password = document.getElementById('password').value;
	var email = document.getElementById('email').value;
	var notifyOfUpdates = document.getElementById('notify-of-updates').checked;
	POST('/captcha/try', data, function() {
		register.value = lang.registering;
		try {
			var salt = sjcl.random.randomWords(2);
			var files_key = window.files_key = sjcl.random.randomWords(8);
			var hmac_bits = sjcl.random.randomWords(4);
		} catch(e) {
			alert(lang.error);
			throw e;
		}
		var key = sjcl.misc.pbkdf2(password, salt, 1000);
		var private_key = window.private_key = key.slice(128/32); // Second half
		var shared_key = key.slice(0, 128/32); // First half
		var private_hmac = window.private_hmac = new sjcl.misc.hmac(private_key);
		var files_hmac = window.files_hmac = new sjcl.misc.hmac(hmac_bits);
		var authkey = sjcl.codec.hex.fromBits(shared_key).toUpperCase();
		
		POST('/register', {
			username: username,
			salt: sjcl.codec.hex.fromBits(salt).toUpperCase(),
			authkey: authkey,
			password_backup_key: sjcl.codec.hex.fromBits(window.password_backup_key).toUpperCase(),
			email: email
		}, function(response) {
			window.account_info = JSON.parse(decodeURIComponent(document.cookie.match(/account_info=(.*)(?:;|$)/)[1]).match(/{.*}/)[0]);
			register.value = lang.uploading;
			JSZipUtils.getBinaryContent('/v2/current', function(err, data) {
				if(err) {
					register.disabled = false;
					register.value = lang.register;
					alert(lang.error);
					return;
				}
				
				var zip = new JSZip(data);

				var getFile = function(file, options, callback) {
					if(!window.getFileCache[file] && file.substr(-1) !== '/' && zip.files[file.substr(1)]) {
						if(typeof options === 'function' || options === undefined) {
							callback = options;
							options = {};
						}
						var zipfile = zip.files[file.substr(1)];
						if(options.codec) {
							if(callback) callback(codec[options.codec].fromAB(zipfile.asArrayBuffer()));
							return;
						}
						if(callback) callback(zipfile.asText());
						return;
					}
					return _getFile(file, options, callback);
				};
				eval(zip.files['Core/core.js'].asText());
				var _getFile = window.getFile;
				window.getFile = getFile;

				var keys = Object.keys(zip.files);
				var target = '/';
				keys.forEach(function(path) {
					var file = zip.files[path];
					if(!file.options.dir) {
						putFile(target + path, {codec: 'arrayBuffer'}, file.asArrayBuffer(), {from: 'origin', parentFrom: 'origin'});
					}
				});
				putFile('/key', sjcl.codec.hex.fromBits(files_key).toUpperCase());
				putFile('/hmac', sjcl.codec.hex.fromBits(hmac_bits).toUpperCase());
				putFile('/settings', {codec: 'prettyjson'}, {core: {notifyOfUpdates: notifyOfUpdates}});
				
				history.pushState({}, '', '/');
				getFile('/Core/startup.js', function(contents) {
					eval(contents);
					//alert(lang.done);
				});
				getFile('/Core/loader.js', function(contents) {
					eval(contents);
				});
			});
		}, function(req) {
			register.disabled = false;
			register.value = lang.register;
			if(req.status === 409) {
				alert(lang.taken);
			} else {
				alert(lang.error);
			}
		});
	}, function(req) {
		register.disabled = false;
		register.value = lang.register;
		if(req.status === 403) {
			alert(lang.wrong);
		} else {
			alert(lang.error);
		}
		captcha.refresh();
	});
});