(function () {
  document.querySelectorAll('.role-btn[data-href]').forEach((btn) => {
    btn.addEventListener('click', () => {
      location.href = btn.dataset.href;
    });
  });
})();
