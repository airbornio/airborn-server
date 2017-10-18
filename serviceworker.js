const GITHUB_API_URL = 'https://api.github.com/repos/airbornos/airborn-server/contents/?ref=';
const UPDATE_GITHUB_API_URL = 'https://api.github.com/repos/airbornos/airborn-update/contents/?ref=';

function getGitHubPath(path) {
	if(path === '') return 'index.html';
	if(path.startsWith('v2')) return path.replace('/', '-');
	if(!path.includes('.')) return path + '.html';
	return path;
}

function shouldCheckGitHub(path) {
	if(['content', 'demo', 'register', 'terms', 'plans', 'messages'].some(page => path.startsWith(page))) {
		return false;
	}
	return !path.replace('v2/', '').includes('/');
}

function checkGitHubAsync(path) {
	return path.startsWith('index') || path.startsWith('main');
}

function shouldCache(path) {
	return !path.startsWith('v2');
}

var clientReady = {};
self.addEventListener('fetch', event => {
	var path = getGitHubPath(new URL(event.request.url).pathname.substr(1));
	if(event.request.method === 'GET' && shouldCheckGitHub(path)) {
		var cachedResponse = caches.match(event.request);
		event.respondWith(
			cachedResponse.then(cachedResponse => cachedResponse ? cachedResponse.clone() : freshResponse)
		);
		var freshResponse = Promise.all([cachedResponse, fetch(event.request)]).then(async function([cachedResponse, freshResponse]) {
			if(freshResponse.ok) {
				var check = Promise.all([
					cachedResponse && cachedResponse.clone().arrayBuffer(),
					freshResponse.clone().arrayBuffer(),
				]).then(async function([cachedBuffer, freshBuffer]) {
					var githubCommit = freshResponse.headers.get('X-GitHub-Commit');
					if(cachedBuffer && equal(cachedBuffer, freshBuffer)) {
						notifyAboutUpdate(event.clientId, 'response_unchanged', path, githubCommit);
						if(shouldCache(path)) event.waitUntil(cachePut(event.request, freshResponse)); // Update X-GitHub-Commit
						return true;
					} else {
						var githubResponse = githubCommit && await getGitHubResponse(path, githubCommit);
						var githubContents = githubResponse && await githubResponse.json();
						if(githubContents instanceof Array) {
							var fileDescr = githubContents.find(descr => descr.path === path);
							if(!fileDescr) {
								console.info('Not found on GitHub:', path);
								// Technically, this falls under "matches the
								// version on GitHub". Obviously, if the only
								// thing a GitHub commit does is remove a file
								// from GitHub, that's suspicious, but if it
								// changes other files as well, less so, and we
								// have to trust the commit on GitHub here.
								notifyAboutUpdate(event.clientId, 'response_matches', path, githubCommit, !!cachedResponse);
								if(shouldCache(path)) event.waitUntil(cacheDelete(event.request));
								return true;
							} else if(
								fileDescr.size === freshBuffer.byteLength &&
								fileDescr.sha === await gitSHA(freshBuffer)
							) {
								notifyAboutUpdate(event.clientId, 'response_matches', path, githubCommit, !!cachedResponse);
								if(shouldCache(path)) event.waitUntil(cachePut(event.request, freshResponse));
								return true;
							} else {
								notifyAboutUpdate(event.clientId, 'response_does_not_match', path, githubCommit, !!cachedBuffer);
								return false;
							}
						} else {
							var client_error = !githubCommit || githubResponse && githubResponse.status >= 400 && githubResponse.status < 500;
							notifyAboutUpdate(event.clientId, client_error ? 'response_does_not_match' : 'could_not_reach_github', path, githubCommit, !!cachedBuffer);
							return !client_error;
						}
					}
				});
				event.waitUntil(check);
				if(!checkGitHubAsync(path) && !await check) {
					return new Response(`
						<!DOCTYPE html>
						<html>
						<head>
							<meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no">
							<link rel="stylesheet" href="main.css">
							<link rel="stylesheet" href="index.css">
						</head>
						<body>
							<div id="container">
								<a href="app" id="login-button"><span class="icon-lock"></span> Login</a>
							</div>
							<script src="main.js"></script>
							<script src="index.js"></script>
						</body>
						</html>
					`, {status: 500, statusText: 'Did not match signature'});
				}
				return freshResponse.clone();
			}
			return freshResponse;
		});
		event.waitUntil(freshResponse);
	}
	BEFORE_FIRST_FETCH = false;
});

var clientReady = {};
var onClientReady = {};
self.addEventListener('message', event => {
	if(event.data.msg === 'ready') {
		if(onClientReady[event.source.id]) {
			onClientReady[event.source.id]();
		} else {
			clientReady[event.source.id] = Promise.resolve();
		}
	}
});

async function getGitHubResponse(path, ref) {
	var githubUrl = (path.startsWith('v2') ? UPDATE_GITHUB_API_URL : GITHUB_API_URL) + (ref || '').replace(/\W+/g, '');
	var response = await caches.match(githubUrl);
	if(!response) {
		response = await fetch(githubUrl);
		if(response.ok) {
			cachePut(githubUrl, response.clone());
		}
	}
	return response;
}

async function notifyAboutUpdate(clientId, msg, path, githubCommit, inCache) {
	var clientList = clientId ? [await clients.get(clientId)] : await clients.matchAll({
		includeUncontrolled: true,
		type: 'window',
	});
	clientList.forEach(async function(client) {
		// For the first few requests (e.g. the html file and the first css
		// file) the client might not be ready for messages yet (no message
		// event handler installed yet). Therefore, we wait until we get a
		// message that it's ready.
		await (clientReady[client.id] || (clientReady[client.id] = new Promise(function(resolve) {
			onClientReady[client.id] = resolve;
		})));
		client.postMessage({
			action: 'notifyAboutUpdate',
			msg: msg,
			path: path,
			githubCommit: githubCommit,
			inCache: inCache,
		});
	});
}

function cachePut(request, response) {
	return caches.open('airborn-server-v1').then(cache => cache.put(request, response));
}

function cacheDelete(request) {
	return caches.open('airborn-server-v1').then(cache => cache.delete(request));
}

// https://stackoverflow.com/questions/460297/git-finding-the-sha1-of-an-individual-file-in-the-index/24283352
async function gitSHA(buffer) {
	var prefix = 'blob ' + buffer.byteLength + '\0';
	var prefixLen = prefix.length;
	var newBuffer = new ArrayBuffer(buffer.byteLength + prefixLen);
	var view = new Uint8Array(newBuffer);
	for(var i = 0; i < prefixLen; i++) {
		view[i] = prefix.charCodeAt(i);
	}
	view.set(new Uint8Array(buffer), prefixLen);
	return hex(await crypto.subtle.digest('sha-1', newBuffer));
}

// https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/digest
function hex(buffer) {
	var view = new DataView(buffer);
	var hexParts = [];
	for(var i = 0; i < view.byteLength; i += 4) {
		hexParts.push(('00000000' + view.getUint32(i).toString(16)).slice(-8));
	}
	return hexParts.join('');
}

// https://stackoverflow.com/questions/21553528/how-can-i-test-if-two-arraybuffers-in-javascript-are-equal
function equal(buf1, buf2) {
	if(buf1.byteLength !== buf2.byteLength) return false;
	var dv1 = new Int8Array(buf1);
	var dv2 = new Int8Array(buf2);
	for(var i = 0; i !== buf1.byteLength; i++) {
		if(dv1[i] !== dv2[i]) return false;
	}
	return true;
}

var BEFORE_FIRST_FETCH = true;
registration.addEventListener('updatefound', function(event) {
	// When the service worker gets updated, there may not necessarily be a
	// client that can show a message for us (e.g., it may be triggered by a 404
	// page). Therefore, we show a web notification.
	if(!BEFORE_FIRST_FETCH) {
		self.registration.showNotification('Airborn OS has been updated.', {
			body: "We can't be sure that it's an update that's publicly available on GitHub. Please check that you trust this update or stop using this version of Airborn OS.",
			icon: 'images/logo-mark.png'
		});
	}
});