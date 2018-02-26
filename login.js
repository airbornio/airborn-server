function GET(url, callback, err, authkey, username) {
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
	if(username) req.setRequestHeader('X-Username', username);
	req.send(null);
}

function decryptAndMaybeUngzip(key, contents) {
	var outparams = {};
	var decrypted = sjcl.decrypt(key, contents, {raw: 1}, outparams);
	if(outparams.adata.length) {
		decrypted = pako.ungzip(new Uint8Array(sjcl.codec.arrayBuffer.fromBits(decrypted)), {to: 'string'});
		/* arrayBuffer.fromBits adds padding by default, but that's allowed for gzip files. */
	} else {
		decrypted = sjcl.codec.utf8String.fromBits(decrypted);
	}
	return decrypted;
}

function login(creds, firstfile, requestmorecreds, success, error) {
	var username = creds.username;
	var password = creds.password;
	var key = creds.key;
	var files_key = creds.files_key;
	var hmac_bits = creds.hmac_bits;
	var salt = creds.salt;
	var needToSendUsername = !!salt;
	var needToAuth = true;
	var authkey;
	var storage = {};
	if(username && (key || password)) {
		(salt ? Promise.resolve(salt) : new Promise(function(resolve, reject) {
			GET('user/' + username + '/salt', function(response) {
				salt = sjcl.codec.hex.toBits(response);
				resolve();
			}, reject);
		})).then(function() {
			storage.salt = salt;
			storage.username = window.username = username;
			return key ? Promise.resolve(key) : deriveKey(password, salt, 1000);
		}).then(function(key) {
			storage.key = key;
			window.private_key = key.slice(128/32); // Second half
			var shared_key = key.slice(0, 128/32); // First half
			window.private_hmac = new sjcl.misc.hmac(window.private_key);
			authkey = sjcl.codec.hex.fromBits(shared_key).toUpperCase();
			
			return Promise.all([
				firstfile && files_key || new Promise(function(resolve, reject) {
					GET('object/' + sjcl.codec.hex.fromBits(window.private_hmac.mac('/key')), function(response) {
						try {
							files_key = decryptAndMaybeUngzip(window.private_key, response);
						} catch(e) {
							files_key = decryptAndMaybeUngzip(password, response);
						}
						files_key = sjcl.codec.hex.toBits(files_key);
						needToAuth = needToSendUsername = false;
						resolve();
					}, reject, authkey, needToSendUsername && username);
				}),
				hmac_bits || new Promise(function(resolve, reject) {
					GET('object/' + sjcl.codec.hex.fromBits(window.private_hmac.mac('/hmac')), function(response) {
						try {
							hmac_bits = decryptAndMaybeUngzip(window.private_key, response);
						} catch(e) {
							hmac_bits = decryptAndMaybeUngzip(password, response);
						}
						hmac_bits = sjcl.codec.hex.toBits(hmac_bits);
						needToAuth = needToSendUsername = false;
						resolve();
					}, reject, authkey, needToSendUsername && username);
				})
			]);
		}).then(function() {
			window.files_key = storage.files_key = files_key;
			storage.hmac_bits = hmac_bits
			window.files_hmac = new sjcl.misc.hmac(hmac_bits);
			
			if(firstfile) {
				if(!needToAuth) prefetchFiles();
				
				return new Promise(function(resolve, reject) {
					GET('object/' + sjcl.codec.hex.fromBits(window.files_hmac.mac(firstfile)), function(response) {
						resolve(decryptAndMaybeUngzip(files_key, response))
					}, reject, needToAuth && authkey, needToSendUsername && username);
				}).catch(function(req) {
					if(req.status === 404) {
						setTimeout(function() {
							window.location = '/update';
						});
					} else {
						throw req;
					}
				});
			}
		}).then(function(firstfilecontents) {
			window.account_info = JSON.parse(decodeURIComponent(document.cookie.match(/account_info=(.*)(?:;|$)/)[1]).match(/{.*}/)[0]);
			window.S3Prefix = window.account_info.S3Prefix;
			window.account_version = window.account_info.account_version;
			if(window.account_version === 1) {
				storage.password = window.password = password;
			}
			if(firstfile) {
				if(needToAuth) prefetchFiles();
				
				window.eval(firstfilecontents);
			}
			success(storage);
		}).catch(function(req) {
			if(req.status === 401) {
				error({status: req.status, statusText: req.statusText, id: 'wrongpass'});
			} else if(req.status === 404) {
				error({status: req.status, statusText: req.statusText, id: 'wronguser'});
			} else {
				error({status: req.status, statusText: req.statusText, id: 'error'});
			}
		});
	} else {
		error({status: 0, statusText: '', id: 'missingcreds'});
	}
	
	function prefetchFiles() {
		[
			'/Core/modules/core/core.js',
			'/Core/modules/startup/startup.js',
			'/Core/modules/startup/loader.js',
			'/Core/lib/yaml/js-yaml.js',
			'/Core/lib/esprima/esprima.js',
			'/Core/lib/estraverse/estraverse.js',
		].forEach(function(url) {
			var link = document.createElement('link');
			link.rel = 'prefetch';
			link.href = 'object/' + sjcl.codec.hex.fromBits(window.files_hmac.mac(url));
			document.body.appendChild(link);
		});
	}
}