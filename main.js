if('serviceWorker' in navigator) {
	// Populate Service Worker Cache with serviceworker.js, so that we
	// can check for updates (not foolproof, see below).
	fetch('/serviceworker.js');
	
	navigator.serviceWorker.register('/serviceworker.js').then(function(registration) {
		navigator.serviceWorker.ready.then(function() {
			registration.active.postMessage({
				msg: 'ready',
			});
		});
		
		registration.addEventListener('updatefound', function(event) {
			if(registration.active !== null) { // If there is an active Service Worker...
				notifyAboutUpdate('updatefound', 'serviceworker.js'); // ... notify that there's a new one.
			}
			
			// Check serviceworker.js against GitHub. Warning: this is
			// not foolproof (at least in Chrome, this launches a
			// seperate request from the request to serviceworker.js
			// that Chrome actually uses). Therefore, we also notify
			// (above) regardless of the outcome of this check.
			fetch('/serviceworker.js');
		});
	}).catch(function() {
		notifyAboutUpdate('sw_failed');
	});
	
	navigator.serviceWorker.addEventListener('message', function(event) {
		if(event.data.action === 'notifyAboutUpdate') {
			notifyAboutUpdate(event.data.msg, event.data.path, event.data.githubCommit, event.data.inCache);
		}
	});
} else {
	setTimeout(function() {
		notifyAboutUpdate('sw_not_supported');
	});
}

var msg_levels = {unchanged: 0, changed: 1, info: 2, warning: 3, error: 4};
var msg_console = ['info', 'info', 'info', 'warn', 'error'];
var msg_icons = ['check', 'check', 'info', 'warning', 'error'];
var msg_colors = ['green', 'green', 'blue', 'yellow', 'red'];
var msg_strings = {
	updatefound_sw: ['warning', "Airborn has been updated. We can't be sure that it's an update that's publicly available on GitHub. Please check that you trust this update or stop using this version of Airborn."],
	
	response_unchanged: ['unchanged', "Airborn is still the same version as last time you opened it."],
	response_matches: ['changed', "Airborn was updated. The new version matches the publicly available version."],
	response_matches_sw: ['warning', "Airborn was updated. It seems the new version matches the publicly available version, but we can't be sure. Please check that you trust this update or stop using this version of Airborn."],
	response_does_not_match: ['info', "Someone attempted to update your version of Airborn to a version that's not publicly available, and shouldn't be trusted. We rejected the update. If you want to continue using the version of Airborn you currently have, don't clear your browser storage and don't force-refresh this page."],
	response_does_not_match_sw: ['error', "Airborn has been updated to a version that's not publicly available, and shouldn't be trusted! We recommended that you stop using this version of Airborn."],
	could_not_reach_github: ['info', "There's an update available for Airborn, but we couldn't check that it's an update that's publicly available on GitHub. You can continue using the old version. If you trust and want to use the new version (not recommended), clear your browser storage for this website and force-refresh this page."],
	could_not_reach_github_sw: ['error', "Airborn has been updated, but we couldn't check that it's an update that's publicly available on GitHub. Please check that you trust this update or stop using this version of Airborn."],
	
	new_response_matches: ['info', "This version of Airborn seems to be the publicly available version. However, since this is the first time you open Airborn here, you should check that you trust this computer and this version of Airborn."],
	new_response_does_not_match: ['error', "This version of Airborn is not the publicly available version. It's recommended that you don't enter your username and password."],
	new_could_not_reach_github: ['error', "We could not check whether this version of Airborn is the publicly available version. Please check that you trust this version, otherwise, don't enter your username and password."],
	
	sw_not_supported: ['warning', "Please switch to a recent version of Chrome or Firefox to increase the security of Airborn. (Service Workers are not supported in your browser.) We could not check whether this version of Airborn is the publicly available version. Please check that you trust this version, otherwise, don't enter your username and password."],
	sw_failed: ['error', "We could not check whether this version of Airborn is the publicly available version. Please check that you trust this version, otherwise, don't enter your username and password."],
};

const GITHUB_URL = 'https://github.com/airbornos/airborn-server/tree/';

var updateNotice = document.createElement('div');
updateNotice.id = 'updateNotice';
document.body.appendChild(updateNotice);
var last_msg_level = -1;
function notifyAboutUpdate(msg, path, githubCommit, inCache) {
	if(!githubCommit) githubCommit = 'master';
	var is_urgent = false;
	if(inCache === false) {
		msg = 'new_' + msg;
	} else if(path === 'serviceworker.js') {
		msg += '_sw';
		is_urgent = true;
	} else if(msg === 'response_does_not_match' || msg === 'could_not_reach_github') {
		is_urgent = true;
	}
	var msg_string = msg_strings[msg];
	if(!msg_string) {
		// response_unchanged_sw
		return;
	}
	var msg_str = msg_string[1];
	var msg_level = msg_levels[msg_string[0]];
	console[msg_console[msg_level]]('%c' + msg_str + ' (' + msg + ', ' + githubCommit + (path ? ', ' + path : '') + ')', 'background: #6cb4b8; color: ' + msg_colors[msg_level]);
	if(msg === 'new_response_matches' && (last_msg_level === 0 || last_msg_level === 1) && !path.includes('.html')) {
		// If we have both old matching (unchanged or changed)
		// responses, and new matching responses, don't specifically
		// notify about the installation being "new", because it's not.
		msg_level = last_msg_level;
	}
	if(msg_level > last_msg_level && (is_urgent || location.pathname === '/app')) {
		updateNotice.innerHTML = '<span class="close-button" onclick="updateNotice.innerHTML = \'\'">✖</span>' +
			'<span class="icon icon-' + msg_icons[msg_level] + '" style="color: ' + msg_colors[msg_level] + '"></span> ' +
			msg_str +
			'<br><a href="' + GITHUB_URL + githubCommit + '" target="_blank" class="github-link">View the source code on GitHub</a>';
		last_msg_level = msg_level;
	} else if(updateNotice.innerHTML && msg !== 'updatefound_sw') {
		// If we've previously linked to GitHub, but we're getting
		// responses from the server from multiple GitHub commits, add
		// an additional link to GitHub.
		var githubLinks = Array.from(updateNotice.querySelectorAll('a.github-link'));
		if(githubLinks.length && !githubLinks.some(function(githubLink) {
			return githubLink.href === GITHUB_URL + githubCommit;
		})) {
			githubLinks.pop().insertAdjacentHTML('afterend', ', <a href="' + GITHUB_URL + githubCommit + '" target="_blank" class="github-link">GitHub</a>');
		}
	}
}

if(document.referrer && !window.sessionStorage.referrer) {
	window.sessionStorage.referrer = document.referrer;
}