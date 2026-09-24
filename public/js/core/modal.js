function openModal(id) {
  var el = document.getElementById(id);
  if (el) el.classList.add('open');
}
var om = openModal;

function closeModal(id) {
  var el = document.getElementById(id);
  if (el) el.classList.remove('open');
}

function openModalBg(id) {
  openModal(id);
}

function closeModalBg(id) {
  closeModal(id);
}

(function() {
  function handleModalBgClick(e) {
    if (e.target.classList.contains('modal-bg')) {
      e.target.classList.remove('open');
    }
  }
  if (document.body) {
    document.body.addEventListener('click', handleModalBgClick);
  } else {
    document.addEventListener('DOMContentLoaded', function() {
      document.body.addEventListener('click', handleModalBgClick);
    });
  }
})();
