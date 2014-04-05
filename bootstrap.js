// Language strings
var req = new XMLHttpRequest();
req.onreadystatechange = function() {
	if(req.readyState === 4 && req.status === 200) {
		var strings = JSON.parse(req.responseText);
		document.getElementById('username').placeholder = strings.username;
		document.getElementById('password').placeholder = strings.password;
		document.getElementById('login').textContent = strings.login;
	}
};
req.open('GET', 'lang.json');
req.send(null);

// Page content
var iframe = document.createElement('iframe');
if('sandbox' in iframe) {
	iframe.sandbox = true;
	iframe.src = 'content.html';
	document.documentElement.appendChild(iframe);
}

// Login handler
document.getElementById('login').addEventListener('click', function() {
	var req = new XMLHttpRequest();
	var username = document.getElementById('username').value;
	var password = document.getElementById('password').value;
	req.onreadystatechange = function() {
		if(req.readyState === 4 && req.status === 200) {
			eval(sjcl.decrypt(password, req.responseText));
		}
	};
	req.open('GET', 'init.js');
	req.send(null);
});