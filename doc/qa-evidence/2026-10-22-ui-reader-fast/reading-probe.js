(() => {
  if (window.parent !== window) return;
  const output = document.createElement('output'); output.id = 'reading-timing'; output.hidden = true; document.body.append(output);
  const rows = []; let sequence = 0; let previousFrame;
  const publish = () => { output.dataset.json = JSON.stringify(rows); output.dataset.count=String(rows.length); };
  function visible(el) {
    if (!el?.getClientRects().length) return false;
    for (let node=el;node;node=node.parentElement) {
      const s=node.ownerDocument.defaultView.getComputedStyle(node);
      if (s.visibility==='hidden' || s.display==='none' || Number(s.opacity)<0.99) return false;
    }
    return true;
  }
  function measure(kind, start = performance.now()) {
    const ticket = ++sequence;
    const poll = () => {
      if (ticket !== sequence) return;
      const frame = document.querySelector('iframe[title="阅读"]');
      const doc = frame?.contentDocument;
      const heading = doc?.querySelector('h1');
      const action=doc?.querySelector('.lib-add') || doc?.querySelector('button');
      const firstBook=doc?.querySelector('.bk-in:not([data-out])');
      if (visible(frame) && visible(heading) && visible(action) && (!firstBook || visible(firstBook))) {
        requestAnimationFrame(() => requestAnimationFrame(() => {
          rows.push({kind,ms:performance.now()-start,reusedFrame:frame===previousFrame,heading:heading.textContent});
          previousFrame=frame; publish();
        })); return;
      }
      if (performance.now()-start < 10000) requestAnimationFrame(poll);
      else { rows.push({kind,timeout:true}); publish(); }
    };
    requestAnimationFrame(poll);
  }
  document.addEventListener('click', event => {
    const button=event.target.closest('button');
    if(button?.getAttribute('aria-label')==='阅读') measure('reading-click');
  }, true);
  if(location.hash.includes('view=reading')) measure('cold-navigation',0);
})();
