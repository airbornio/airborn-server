// First try to login with previously saved credentials
login(JSON.parse(localStorage.creds || sessionStorage.creds || '{}'), '/Core/init.js', function() {}, function(storecreds) {
	(localStorage.creds ? localStorage : sessionStorage).creds = JSON.stringify(storecreds);
	updateNotice.innerHTML = '';
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
		document.getElementById('forgot').textContent = strings.forgot;
		document.title = strings.sitename;
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
	
	// Login area
	document.getElementById('container').classList.add('show');
	document.getElementById('login-form').addEventListener('submit', function(evt) {
		evt.preventDefault();
		var storage = document.getElementById('save').checked ? localStorage : sessionStorage;
		var username = document.getElementById('username').value;
		var password = document.getElementById('password').value;
		login({username: username, password: password}, '/Core/init.js', function() {}, function(storecreds) {
			storage.creds = JSON.stringify(storecreds);
			if(iframe.parentElement) document.body.removeChild(iframe);
			updateNotice.innerHTML = '';
		}, function(err) {
			alert(lang[err.id]);
		});
	});
	
}