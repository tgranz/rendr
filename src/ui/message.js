const messageElement = document.getElementById('message');
let messageTimeoutId = null;

window.setMessage = function(message, icon = 'alert-triangle', color = '#000000', timeout = 5000) {
    messageElement.innerHTML = `<i class="ti ti-${icon}"></i><span>${message}</span>`;
    messageElement.style.setProperty('background-color', `${color}55`);
    messageElement.style.display = 'flex';

    messageElement.classList.remove('message-flash');
    void messageElement.offsetWidth;
    messageElement.classList.add('message-flash');

    if (messageTimeoutId !== null) {
        window.clearTimeout(messageTimeoutId);
    }

    messageTimeoutId = window.setTimeout(() => {
        messageElement.innerHTML = '';
        messageElement.style.removeProperty('background-color');
        messageElement.style.display = 'none';
        messageElement.classList.remove('message-flash');
        messageTimeoutId = null;
    }, timeout);
}