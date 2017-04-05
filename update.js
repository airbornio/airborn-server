var lang = {};
GET('lang.json', function(response) {
	var strings = lang = JSON.parse(response);
	document.getElementById('username').placeholder = strings.username;
	document.getElementById('password').placeholder = strings.password;
	document.getElementById('update').value = strings.update;
	document.getElementById('explanation').textContent = strings.updateexplanation;
});

document.getElementById('container').addEventListener('submit', function(evt) {
	evt.preventDefault();
	
	document.getElementById('update').disabled = true;
	document.getElementById('update').value = lang.updating;
	
	login({username: document.getElementById('username').value, password: document.getElementById('password').value}, null, function() {}, function() {
		JSZipUtils.getBinaryContent('/v2/current', function(err, data) {
			if(err) {
				document.getElementById('update').disabled = false;
				document.getElementById('update').value = lang.update;
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
					putFile(target + path, {codec: 'arrayBuffer', transactionId: 'serverupdate'}, file.asArrayBuffer());
				}
			});
			
			history.pushState({}, '', '/');
			getFile('/Core/startup.js', function(contents) {
				eval(contents);
				//alert(lang.updatedone.replace('{email}', '<a href="mailto:support@airbornos.com">support@airbornos.com</a>'));
				document.querySelector('.bar').remove();
				document.querySelector('.background').remove();
				document.getElementById('container').remove();
			});
			getFile('/Core/loader.js', function(contents) {
				eval(contents);
			});
		});
	}, function(err) {
		document.getElementById('update').disabled = false;
		document.getElementById('update').value = lang.update;
		alert(lang[err.id]);
	});
});