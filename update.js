// First try to update with previously saved credentials
login(JSON.parse(localStorage.creds || sessionStorage.creds || '{}'), null, function() {}, function() {
	update(buildUpdateForm);
}, buildUpdateForm);

var lang = {};
function buildUpdateForm() {
	
	// Language strings
	GET('lang.json', function(response) {
		var strings = lang = JSON.parse(response);
		document.getElementById('username').placeholder = strings.username;
		document.getElementById('password').placeholder = strings.password;
		document.getElementById('update').value = strings.update;
		document.getElementById('explanation').textContent = strings.updateexplanation;
	});
	
	// Page content
	var iframe = document.createElement('iframe');
	if('sandbox' in iframe) {
		iframe.sandbox = 'allow-top-navigation allow-same-origin';
		iframe.src = 'content-app';
		iframe.id = 'content';
		iframe.addEventListener('load', function() {
			Array.prototype.forEach.call(iframe.contentDocument.getElementsByClassName('needsfocus'), function(elm) {
				elm.addEventListener('click', function() {});
			});
		});
		document.body.appendChild(iframe);
	}
	
	// Update area
	document.getElementById('container').classList.add('show');
	document.getElementById('container').addEventListener('submit', function(evt) {
		evt.preventDefault();
		
		document.getElementById('update').disabled = true;
		document.getElementById('update').value = lang.updating;
		
		login({username: document.getElementById('username').value, password: document.getElementById('password').value}, null, function() {}, function() {
			update(error);
		}, error);
	});
	
}

function update(error) {
	var loaderScript = document.createElement('script');
	loaderScript.src = 'v2/live/Core/modules/startup/loader.js';
	loaderScript.integrity = 'sha256-7iN78fw+0n72xjCkvZcnwklwdFf9QgT1Pym6k8P04+g=';
	document.body.appendChild(loaderScript);
	
	JSZipUtils.getBinaryContent('/v2/current', function(err, data) {
		if(err) {
			document.getElementById('loading').remove();
			error(err);
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
		eval(zip.files['Core/modules/core/core.js'].asText());
		var _getFile = window.getFile;
		window.getFile = getFile;
		
		var keys = Object.keys(zip.files);
		var target = '/';
		
		keys.forEach(function(path, i) {
			var file = zip.files[path];
			if(!file.options.dir) {
				putFile(target + path, {codec: 'arrayBuffer', transactionId: 'serverupdate'}, file.asArrayBuffer(), i === keys.length - 1 ? function() {
					// Transaction finished; all files have been uploaded
					setTimeout(function() { // Wait 30s to be sure
						window.hideNotice('serverupdating');
					}, 30000);
				} : undefined);
			}
		});
		
		history.pushState({}, '', '/app');
		getFile('/Core/modules/startup/startup.js', function(contents) {
			eval(contents);
			var iframe = document.getElementById('content');
			if(iframe) iframe.remove();
			document.getElementById('container').remove();
			window.showNotice('serverupdating', "Updating… Please don't close this tab.");
		});
	});
}

function error(err) {
	document.getElementById('update').disabled = false;
	document.getElementById('update').value = lang.update;
	alert(lang[err.id || 'error']);
}