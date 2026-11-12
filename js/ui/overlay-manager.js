/* ============================================================
   UI OVERLAY MANAGER
   Accessible, lightweight Modal, Confirmation, Bottom-Sheet,
   and Toast feedback system. Zero external dependencies.
   Replaces all native browser alert(), confirm(), and prompt().
   ============================================================ */

(function (global) {
  'use strict';

  let overlayRoot = null;
  let toastRoot = null;
  let activeOverlays = [];
  let previousActiveElement = null;

  function ensureRoots() {
    if (!overlayRoot) {
      overlayRoot = document.getElementById('overlay-container');
      if (!overlayRoot) {
        overlayRoot = document.createElement('div');
        overlayRoot.id = 'overlay-container';
        overlayRoot.className = 'overlay-container';
        document.body.appendChild(overlayRoot);
      }
    }

    if (!toastRoot) {
      toastRoot = document.getElementById('toast-container');
      if (!toastRoot) {
        toastRoot = document.createElement('div');
        toastRoot.id = 'toast-container';
        toastRoot.className = 'toast-container';
        toastRoot.setAttribute('aria-live', 'polite');
        toastRoot.setAttribute('aria-atomic', 'true');
        document.body.appendChild(toastRoot);
      }
    }
  }

  function trapFocus(modalEl, e) {
    if (e.key !== 'Tab') return;
    const focusable = modalEl.querySelectorAll(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    if (focusable.length === 0) {
      e.preventDefault();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (e.shiftKey) {
      if (document.activeElement === first) {
        last.focus();
        e.preventDefault();
      }
    } else {
      if (document.activeElement === last) {
        first.focus();
        e.preventDefault();
      }
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Escape' && activeOverlays.length > 0) {
      const current = activeOverlays[activeOverlays.length - 1];
      if (current.dismissible) {
        e.preventDefault();
        current.close(false);
      }
    }
  }

  window.addEventListener('keydown', handleKeyDown);

  function lockBodyScroll() {
    document.body.classList.add('overlay-open');
  }

  function unlockBodyScroll() {
    if (activeOverlays.length === 0) {
      document.body.classList.remove('overlay-open');
    }
  }

  /* ---------------- Toast Implementation ---------------- */
  function showToast({ message, type = 'info', duration = 3200 }) {
    ensureRoots();
    const toast = document.createElement('div');
    toast.className = `ui-toast ui-toast-${type}`;
    toast.setAttribute('role', 'status');

    let iconHtml = '';
    if (window.Icons) {
      if (type === 'success') iconHtml = `<span class="ui-toast-icon">${Icons.checkCircle || ''}</span>`;
      else if (type === 'error' || type === 'danger') iconHtml = `<span class="ui-toast-icon">${Icons.xCircle || ''}</span>`;
      else if (type === 'warning') iconHtml = `<span class="ui-toast-icon">${Icons.warning || ''}</span>`;
      else iconHtml = `<span class="ui-toast-icon">${Icons.book || ''}</span>`;
    }

    toast.innerHTML = `${iconHtml}<span class="ui-toast-text">${escapeHtml(message)}</span>`;
    toastRoot.appendChild(toast);

    requestAnimationFrame(() => {
      toast.classList.add('visible');
    });

    setTimeout(() => {
      toast.classList.remove('visible');
      setTimeout(() => {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 300);
    }, duration);
  }

  /* ---------------- Dialog / Modal Implementation ---------------- */
  function showDialog({
    title = '',
    message = '',
    type = 'info',
    confirmText = 'ঠিক আছে',
    cancelText = null,
    destructive = false,
    dismissible = true,
  }) {
    ensureRoots();
    previousActiveElement = document.activeElement;

    return new Promise((resolve) => {
      const backdrop = document.createElement('div');
      backdrop.className = 'ui-modal-backdrop';

      const dialog = document.createElement('div');
      dialog.className = `ui-modal-box ui-modal-${type}`;
      dialog.setAttribute('role', 'dialog');
      dialog.setAttribute('aria-modal', 'true');
      const titleId = `modal-title-${Date.now()}`;
      dialog.setAttribute('aria-labelledby', titleId);

      let iconHtml = '';
      if (window.Icons) {
        if (type === 'success') iconHtml = `<div class="ui-modal-icon-badge success">${Icons.checkCircle}</div>`;
        else if (type === 'warning') iconHtml = `<div class="ui-modal-icon-badge warning">${Icons.warning}</div>`;
        else if (type === 'error' || destructive) iconHtml = `<div class="ui-modal-icon-badge danger">${Icons.xCircle || Icons.warning}</div>`;
        else iconHtml = `<div class="ui-modal-icon-badge info">${Icons.book || Icons.target}</div>`;
      }

      dialog.innerHTML = `
        <div class="ui-modal-header">
          ${iconHtml}
          <div class="ui-modal-title-wrap">
            <h3 class="ui-modal-title" id="${titleId}">${escapeHtml(title)}</h3>
          </div>
        </div>
        <div class="ui-modal-body">
          <p class="ui-modal-message">${message.includes('<') ? message : escapeHtml(message)}</p>
        </div>
        <div class="ui-modal-footer">
          ${cancelText ? `<button class="ui-btn ui-btn-secondary" id="ui-modal-cancel">${escapeHtml(cancelText)}</button>` : ''}
          <button class="ui-btn ${destructive ? 'ui-btn-danger' : 'ui-btn-primary'}" id="ui-modal-confirm">${escapeHtml(confirmText)}</button>
        </div>
      `;

      backdrop.appendChild(dialog);
      overlayRoot.appendChild(backdrop);
      lockBodyScroll();

      const overlayEntry = {
        dismissible,
        close: (result) => {
          backdrop.classList.remove('visible');
          setTimeout(() => {
            if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
            activeOverlays = activeOverlays.filter((o) => o !== overlayEntry);
            unlockBodyScroll();
            if (previousActiveElement && typeof previousActiveElement.focus === 'function') {
              previousActiveElement.focus();
            }
            resolve(result);
          }, 200);
        },
      };

      activeOverlays.push(overlayEntry);

      const confirmBtn = dialog.querySelector('#ui-modal-confirm');
      const cancelBtn = dialog.querySelector('#ui-modal-cancel');

      confirmBtn.onclick = () => overlayEntry.close(true);
      if (cancelBtn) {
        cancelBtn.onclick = () => overlayEntry.close(false);
      }

      if (dismissible) {
        backdrop.onclick = (e) => {
          if (e.target === backdrop) {
            overlayEntry.close(false);
          }
        };
      }

      dialog.addEventListener('keydown', (e) => trapFocus(dialog, e));

      requestAnimationFrame(() => {
        backdrop.classList.add('visible');
        if (cancelBtn && destructive) {
          cancelBtn.focus();
        } else {
          confirmBtn.focus();
        }
      });
    });
  }

  /* ---------------- Bottom Sheet Implementation ---------------- */
  function showSheet({ title = '', contentHtml = '', onClose = null }) {
    ensureRoots();
    previousActiveElement = document.activeElement;

    const backdrop = document.createElement('div');
    backdrop.className = 'ui-modal-backdrop ui-sheet-backdrop';

    const sheet = document.createElement('div');
    sheet.className = 'ui-bottom-sheet';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');

    sheet.innerHTML = `
      <div class="ui-sheet-handle-bar"><span class="ui-sheet-handle"></span></div>
      <div class="ui-sheet-header">
        <h3 class="ui-sheet-title">${escapeHtml(title)}</h3>
        <button class="ui-sheet-close-btn" aria-label="বন্ধ করুন">
          <span class="icon">${window.Icons ? Icons.close : '&times;'}</span>
        </button>
      </div>
      <div class="ui-sheet-content">
        ${contentHtml}
      </div>
    `;

    backdrop.appendChild(sheet);
    overlayRoot.appendChild(backdrop);
    lockBodyScroll();

    function closeSheet() {
      backdrop.classList.remove('visible');
      setTimeout(() => {
        if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
        activeOverlays = activeOverlays.filter((o) => o !== overlayEntry);
        unlockBodyScroll();
        if (previousActiveElement && typeof previousActiveElement.focus === 'function') {
          previousActiveElement.focus();
        }
        if (typeof onClose === 'function') onClose();
      }, 250);
    }

    const overlayEntry = {
      dismissible: true,
      close: closeSheet,
    };
    activeOverlays.push(overlayEntry);

    const closeBtn = sheet.querySelector('.ui-sheet-close-btn');
    closeBtn.onclick = closeSheet;

    backdrop.onclick = (e) => {
      if (e.target === backdrop) closeSheet();
    };

    sheet.addEventListener('keydown', (e) => trapFocus(sheet, e));

    requestAnimationFrame(() => {
      backdrop.classList.add('visible');
      closeBtn.focus();
    });

    return {
      close: closeSheet,
      element: sheet,
    };
  }

  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Public API
  global.UIOverlay = {
    alert: function ({ title = 'বিজ্ঞপ্তি', message = '', type = 'info', confirmText = 'ঠিক আছে' }) {
      return showDialog({ title, message, type, confirmText });
    },
    confirm: function ({
      title = 'নিশ্চিত করুন',
      message = '',
      confirmText = 'ঠিক আছে',
      cancelText = 'বাতিল',
      destructive = false,
    }) {
      return showDialog({
        title,
        message,
        type: destructive ? 'error' : 'warning',
        confirmText,
        cancelText,
        destructive,
      });
    },
    toast: function ({ message = '', type = 'info', duration = 3200 }) {
      showToast({ message, type, duration });
    },
    sheet: function ({ title = '', contentHtml = '', onClose = null }) {
      return showSheet({ title, contentHtml, onClose });
    },
  };
})(typeof window !== 'undefined' ? window : this);
