if (window.location.pathname.endsWith('/') || window.location.pathname.endsWith('/index.html')) {
  if (['#compare', '#purchase'].includes(window.location.hash)) {
    window.location.replace('./versions.html' + window.location.hash);
  }
}

const copyButton = document.querySelector('[data-copy]');
if (copyButton && navigator.clipboard?.writeText) {
  const prompt = document.getElementById(copyButton.dataset.copy);
  const status = document.querySelector('.copy-status');
  copyButton.hidden = false;
  copyButton.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(prompt.textContent);
      status.textContent = copyButton.dataset.copied;
    } catch {
      status.textContent = copyButton.dataset.failed;
    }
  });
}
