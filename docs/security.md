# Security

We've gone to really great lengths to make sure that even if our server
gets hacked, the hackers still can't read your documents. We can't read
them either, nor can our hosting provider, our CDN, our storage
provider, or the intern we wish we had.

We've done two things to accomplish this:

1. All documents are encrypted before they leave your computer. This
   means we can't see what's inside or what the documents are called.

2. Normally, when hackers get access to your server, they can change the
   code that gets sent to customers. For example, they could make the
   code say "send your password to us". Then, even though they can't
   read documents immediately, passwords start coming in and they can
   soon read them.

   To solve this, we're using a relatively new web technology (Service
   Workers) to install some code which can't be changed without setting
   off a warning to you. That code then keeps tabs on all other code,
   and checks that it matches the publicly available version on GitHub.
   
   In some cases, such as when Airborn is opened in the background,
   we might be unable to show you a warning when Airborn updates. For
   those cases, you should
   <button onclick="Notification.requestPermission()">enable Web
   Notifications</button> so that we can always show you a notification
   when Airborn updates. We won't show you notifications for anything
   other than that.

<img alt="Client-Side Encryption" src="images/client-side-encryption.png" class="img-container security" id="sidebar">