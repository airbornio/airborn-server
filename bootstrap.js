// First try to login with previously saved credentials
login(JSON.parse(localStorage.creds || sessionStorage.creds || '{}'), '/Core/init.js', function() {}, function(storecreds) {
	(localStorage.creds ? localStorage : sessionStorage).creds = JSON.stringify(storecreds);
}, buildLoginForm);

var lang = {};
function buildLoginForm() {
	
	// Language strings
	GET('lang.json', function(response) {
		var strings = lang = JSON.parse(response);
		document.getElementById('username').placeholder = strings.username;
		document.getElementById('password').placeholder = strings.password;
		document.getElementById('login-submit').value = strings.login;
		document.getElementById('label').textContent = strings.save;
		document.title = strings.sitename;
	});

	// Page content
	var iframe = document.createElement('iframe');
	var interval;
	function updateVisibility() {
		iframe.contentDocument.body.classList.toggle('inactive', document.hidden);
	}
	if('sandbox' in iframe) {
		iframe.sandbox = 'allow-top-navigation allow-same-origin';
		iframe.src = 'content' + (document.referrer && window.URL && new URL(document.referrer).origin === location.origin ? '#noanim' : '');
		iframe.id = 'content';
		iframe.addEventListener('load', function() {
			Array.prototype.forEach.call(iframe.contentDocument.getElementsByClassName('needsfocus'), function(elm) {
				elm.addEventListener('click', function() {});
			});
			updateVisibility();
			document.addEventListener('visibilitychange', updateVisibility);
			var wrap = iframe.contentDocument.getElementById('wrap');
			interval = setInterval(function() {
				if(iframe.contentWindow.pageYOffset || wrap.scrollTop) {
					iframe.contentDocument.body.classList.add('scrolled');
					clearInterval(interval);
					if(iframe.contentDocument.querySelector(':target:not(a)')) {
						wrap.style.webkitOverflowScrolling = 'auto';
						wrap.addEventListener('animationend', function onanimationend() {
							wrap.removeEventListener('animationend', onanimationend);
							wrap.style.webkitOverflowScrolling = '';
						});
					}
				}
			}, 100);
		});
		document.body.appendChild(iframe);

		var script = document.createElement('script');
		script.src = 'analytics.js';
		document.body.appendChild(script);
	}
	
	// Login area
	document.getElementById('container').classList.add('show');
	window.addEventListener('load', function() {
		if(
			window.location.hash === '#login' ||
			document.getElementById('username').value // Password manager
		) {
			document.getElementById('login-form').classList.add('show');
			iframe.contentDocument.body.classList.add('noanim');
		}
	});
	document.getElementById('login-button').addEventListener('mousedown', function(evt) {
		evt.preventDefault();
		if(this === document.activeElement || document.getElementById('login-form').classList.contains('show')) {
			this.blur();
			document.getElementById('login-form').classList.remove('show');
		} else {
			this.focus();
			iframe.contentDocument.body.classList.add('noanim');
		}
	});
	document.getElementById('login-button').addEventListener('click', function(evt) {
		evt.preventDefault();
	});
	document.getElementById('login-form').addEventListener('mousedown', function() {
		this.classList.add('show');
	}, true);
	document.getElementById('login-form').addEventListener('submit', function(evt) {
		evt.preventDefault();
		var storage = document.getElementById('save').checked ? localStorage : sessionStorage;
		var username = document.getElementById('username').value;
		var password = document.getElementById('password').value;
		login({username: username, password: password}, '/Core/init.js', function() {}, function(storecreds) {
			storage.creds = JSON.stringify(storecreds);
			clearInterval(interval);
			document.removeEventListener('visibilitychange', updateVisibility);
			if(iframe.parentElement) document.body.removeChild(iframe);
		}, function(err) {
			alert(lang[err.id]);
		});
	});
	
}