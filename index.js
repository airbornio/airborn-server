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

// Language strings
GET('lang.json', function(response) {
	var strings = JSON.parse(response);
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
}