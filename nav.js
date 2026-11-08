/* Shared navigation: edit this list once, every page updates. */
(function () {
  var L = [
    ['index.html', 'Home'],
    ['spc.html', 'SPC'], ['fmea.html', 'FMEA'], ['sigma.html', 'DPMO'], ['grr.html', 'Gage R&R'], ['pareto.html', 'Pareto'],
    ['eightd.html', '8D'], ['ppap.html', 'PPAP'], ['qfd.html', 'QFD'],
    ['a3.html', 'A3'], ['kaizen.html', 'Kaizen'], ['changeover.html', 'Changeover'],
    ['oee.html', 'OEE and takt'], ['kanban.html', 'WIP simulator'], ['vsm.html', 'VSM'], ['selector.html', 'Selector']
  ];
  var here = (location.pathname.split('/').pop() || 'index.html');
  var el = document.getElementById('nav');
  if (!el) return;
  el.innerHTML = L.map(function (x) {
    return '<a href="' + x[0] + '"' + (x[0] === here ? ' aria-current="page"' : '') + '>' + x[1] + '</a>';
  }).join('');
})();
