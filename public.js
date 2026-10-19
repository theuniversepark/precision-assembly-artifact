const data = JSON.parse(document.getElementById('public-data').textContent);
const rows = data.rows;
const byCode = new Map(rows.map(r => [r.code, r]));
const $ = id => document.getElementById(id);
const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const kinds = {source:'원본 개념형상',concept:'추가 개념 외곽',partial:'부분 대응',shared:'공유 외곽',missing:'독립 형상 없음',service:'기능·용역'};
const zoneGroups = {SCREW:'스크류 체결구역',PRESS:'압입 체결구역',SORT:'분류구역'};
const zoneNames = {SCREW:'스크류 체결',PRESS:'압입 체결',SORT:'분류·공급'};
const flows = {
 E01:['로봇·PLC·HMI','공정 시퀀스·티칭','셀 제어'],
 E02:['장비 자산·신호','AAS 프로그램','자산 정보·인터페이스'],
 E03:['장비·구역 형상','URDF·디지털트윈','모델 연계'],
 E04:['공정·장비 데이터','수집·저장·백업','조회·복원·내보내기'],
 E05:['카메라 영상','위치·자세·종류 인식','좌표 보정'],
 E06:['조립 상태 영상','누락·이종 검사','OK/NG·검사 이력'],
 E07:['이송 요청·미션','AMR 스케줄링','공급·회수'],
 F01:['로봇·PLC·Edge·비전','명령·응답·시간 동기','공정 연계시험'],
 F02:['AMR·도킹 대상','미션·점유 연계','공급·회수'],
 F03:['로컬서버 데이터','통신맵·API','외부 데이터 연계'],
 G01:['장비·모듈','반입·설치·결선','현장 배치'],
 G02:['단품·공정 셀','FAT·SAT','시험·안정화'],
 H01:['공정 셀·제어장비','운영·보전 교육','운영자'],
 H02:['설계·소스·설정','기술문서·백업 인계','운영·유지보수']
};
let page='overview', selected=null, mode='3d', imageView='context', shown=rows.slice();
let viewer=null, viewerReady=false, viewerFailed=false, isolated=false, currentView='iso';
let toastTimer;
const imageDialog=$('image-dialog');

for (const group of new Set(rows.map(r=>r.group))) {
 const option=document.createElement('option');option.value=group;option.textContent=group;$('group-filter').append(option);
}
$('legend-items').innerHTML=data.palette.map(p=>`<span class="legend-item"><i class="legend-dot" style="--color:${esc(p.color)}"></i>${esc(p.name)}</span>`).join('');
$('scope-counts').innerHTML=Object.entries(kinds).map(([kind,label])=>`<button data-kind="${kind}"><strong>${rows.filter(r=>r.kind===kind).length}<span>품목</span></strong><small>${label} ↗</small></button>`).join('');

function toast(message){clearTimeout(toastTimer);$('toast').textContent=message;$('toast').hidden=false;toastTimer=setTimeout(()=>$('toast').hidden=true,3500)}
function saveRoute(){const hash=page==='equipment'&&selected?'#item='+selected:'#'+page;history.replaceState(null,'',hash)}
function setPage(next,{route=true}={}){
 page=next;document.body.dataset.page=page;
 $('workspace').hidden=page==='scope';$('scope-panel').hidden=page!=='scope';
 $('catalog').hidden=page!=='equipment';$('overview-panel').hidden=page!=='overview';
 $('inspector').hidden=page!=='equipment'||!selected;
 for(const a of document.querySelectorAll('[data-nav]')){if(a.dataset.nav===page)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current')}
 if(page==='overview'){selected=null;isolated=false;currentView='iso';viewer?.select(null);viewer?.setView('iso');$('pick-choice').hidden=true}
 renderStage();if(route)saveRoute();requestAnimationFrame(()=>viewer?.resize());
}
function renderList(){
 const query=$('search').value.trim().toLocaleLowerCase('ko');
 shown=rows.filter(r=>(!$('group-filter').value||r.group===$('group-filter').value)&&(!$('kind-filter').value||r.kind===$('kind-filter').value)&&(`${r.code} ${r.name} ${r.group} ${r.category} ${r.note}`.toLocaleLowerCase('ko').includes(query)));
 $('result-count').textContent=shown.length+'개';$('empty').hidden=shown.length>0;
 let lastGroup='';
 $('item-list').innerHTML=shown.map(r=>{let heading='';if(r.group!==lastGroup){heading=`<div class="list-group-title">${esc(r.group)}</div>`;lastGroup=r.group}
 return heading+`<button class="item-button" data-item="${r.code}" aria-current="${r.code===selected}" aria-label="${r.code} ${esc(r.name)} ${r.qty}${esc(r.unit)}"><span class="item-code">${r.code}</span><span class="item-text"><strong>${esc(r.name)}</strong><small><i class="kind-dot ${r.kind}"></i>${kinds[r.kind]}</small></span><span class="item-qty">${r.qty}${esc(r.unit)}</span></button>`}).join('');
}
function clearFilters(){ $('search').value='';$('group-filter').value='';$('kind-filter').value='';renderList() }
function syncSelectionView(code){
 const row=byCode.get(code);
 if(zoneGroups[currentView]&&row?.group!==zoneGroups[currentView]){currentView='iso';viewer?.setView('iso')}
}
function selectItem(code,{reveal=false,clear=false}={}){
 if(!byCode.has(code))return;
 if(clear||!shown.some(r=>r.code===code))clearFilters();
 selected=code;syncSelectionView(code);isolated=false;imageView='context';$('pick-choice').hidden=true;
 setPage('equipment',{route:false});renderList();renderInspector();viewer?.setIsolated(false);viewer?.select(code);renderStage();saveRoute();
 if(reveal){const node=$('item-list').querySelector(`[data-item="${code}"]`);if(node){const list=$('item-list');list.scrollTop=node.offsetTop-list.offsetTop-list.clientHeight/2+node.clientHeight/2}}
}
function filterChanged(){renderList();if(!shown.some(r=>r.code===selected))selected=shown[0]?.code||null;
 syncSelectionView(selected);viewer?.select(selected);isolated=false;viewer?.setIsolated(false);renderList();renderInspector();renderStage();saveRoute();}
function renderInspector(){
 const r=byCode.get(selected);$('inspector').hidden=page!=='equipment'||!r;if(!r){$('inspector').replaceChildren();return}
 const related=(r.kind==='shared'?['A17','A18','A19'].map(code=>byCode.get(code)):rows.filter(x=>x.group===r.group)).filter(x=>x.code!==r.code).slice(0,8);
 const note=r.note||'견적 수량과 연결된 원본 개념형상을 확인할 수 있습니다. 상세 치수와 공급 사양은 상세설계에서 확인합니다.';
 const partialNote=r.kind==='partial'?'부분 표현된 형상의 그룹 수이며 견적 수량과 동일한 단위가 아닐 수 있습니다.':r.kind==='shared'?'한 랙 외곽에 세 견적 코드가 연결되어 있습니다.':'수량 확인용 분리 이미지는 원래 배치에서 재배열했습니다.';
 $('inspector').style.setProperty('--item-color',r.color);
 $('inspector').innerHTML=`<div class="item-detail-header"><div class="detail-code"><span>${r.code}</span><small>${esc(r.group)}</small></div><h2>${esc(r.name)}</h2><div class="quantity-line"><span>견적 수량</span><strong>${r.qty}<em>${esc(r.unit)}</em></strong></div><span class="status-badge ${r.kind}">${esc(r.status)}</span></div>
 <div class="detail-block"><h3>형상과 공급 범위</h3><p>${esc(note)}</p>${r.isolatedImage?`<div class="detail-actions"><button data-action="focus">해당 품목 확대 ↗</button><button data-action="isolated">분리 이미지 보기</button></div>`:''}</div>
 ${r.isolatedImage?`<div class="detail-block"><h3>분리 형상 · ${r.modelCount}개 그룹</h3><button class="thumb-button" data-action="open-image"><img src="${r.isolatedImage}" alt="${r.code} ${esc(r.name)} 분리 개념형상" loading="lazy"><span>크게 보기 ⤢</span></button><p class="caption">${partialNote}</p></div>`:`<div class="detail-block"><h3>${r.kind==='service'?'표현 방식':'확인할 자료'}</h3><p>${r.kind==='service'?'물리 장비와 구분하여 기능의 적용 대상과 연결 관계를 표시합니다.':'전용 CAD 및 상세 공급 구성을 확보한 뒤 형상 대응을 추가할 수 있습니다.'}</p></div>`}
 ${related.length?`<div class="detail-block"><h3>${r.kind==='shared'?'같은 랙을 공유하는 품목':'같은 구역의 다른 품목'}</h3><div class="related">${related.map(x=>`<button data-item="${x.code}" title="${esc(x.name)}">${x.code}</button>`).join('')}</div></div>`:''}
 <div class="detail-block"><div class="detail-actions"><button data-action="copy">품목 링크 복사</button><button data-action="print">검토 화면 인쇄</button></div></div>
 <div class="item-stepper"><button data-step="-1" ${shown.findIndex(x=>x.code===r.code)<=0?'disabled':''}>← 이전 품목</button><button data-step="1" ${shown.findIndex(x=>x.code===r.code)>=shown.length-1?'disabled':''}>다음 품목 →</button></div>`;
}
function renderStage(){
 const r=page==='equipment'?byCode.get(selected):null;
 const isFunction=page==='equipment'&&(!r||!r.contextImage);
 const use3d=mode==='3d'&&!viewerFailed&&!isFunction;
 $('stage-title').textContent=page==='overview'?'전체 공정 배치':r?`${r.code} · ${r.name}`:'검색 결과 없음';
 $('stage-kicker').textContent=page==='overview'?'LAYOUT EXPLORER':r?`${r.group} / ${kinds[r.kind]}`:'EQUIPMENT EXPLORER';
 $('mode-3d').setAttribute('aria-pressed',String(mode==='3d'));$('mode-image').setAttribute('aria-pressed',String(mode==='image'));
 $('mode-3d').disabled=viewerFailed||isFunction;$('mode-image').disabled=isFunction;
 $('model-canvas').hidden=!use3d;
 $('fallback-image').hidden=use3d&&viewerReady||isFunction;
 $('fallback-image').src=r?(imageView==='isolated'?r.isolatedImage:r.contextImage)||data.overview:data.overview;
 $('fallback-image').alt=r?`${r.code} ${r.name} ${imageView==='isolated'?'분리 형상':'전체 배치에서 강조한 위치'}`:'정밀조립 Zone 전체 공정 개념 배치';
 $('functional').hidden=!isFunction;
 if(isFunction){
  const flow=flows[r?.code];
  $('functional').innerHTML=!r?'<div class="function-symbol">⌕</div><h3>일치하는 품목이 없습니다.</h3><p>검색어 또는 구역 필터를 변경해 주세요.</p>':`<div class="function-symbol">${r.kind==='service'?'↔':'◇'}</div><p class="eyebrow">${r.code} · ${kinds[r.kind]}</p><h3>${esc(r.name)}</h3><p>${r.kind==='service'?esc(r.note.replace(' 물리 장비 형상이 아닌 기능·용역으로 연결도를 표시.','')):esc(r.note)}</p>${flow?`<div class="flow"><div>${esc(flow[0])}</div><span>→</span><div>${esc(flow[1])}</div><span>→</span><div>${esc(flow[2])}</div></div>`:''}<div class="function-tag">${r.kind==='service'?'기능 연결을 설명하는 개념도':'독립 형상을 확보하면 모델에 연결합니다'}</div>`;
 }
 $('image-tabs').hidden=!(mode==='image'&&r?.contextImage);
 for(const b of document.querySelectorAll('[data-image-view]'))b.classList.toggle('active',b.dataset.imageView===imageView);
 $('isolate').hidden=!(r?.contextImage&&mode==='3d'&&!viewerFailed);$('isolate').setAttribute('aria-pressed',String(isolated));
 $('stage-hint').textContent=isFunction?'견적 범위 기준 · 물리 장비 형상과 구분':mode==='image'?'이미지 보기 · 우측 확대 버튼으로 크게 확인':'드래그 회전 · 스크롤 확대 · 장비 클릭으로 품목 선택';
 $('zone-labels').hidden=!(page==='overview'&&mode==='image');
 $('zoom-in').hidden=!use3d;$('zoom-out').hidden=!use3d;$('expand-image').hidden=use3d||isFunction;
 $('model-loading').hidden=viewerReady||viewerFailed||!use3d;
 for(const b of document.querySelectorAll('[data-view]')){b.disabled=mode!=='3d'||viewerFailed||isFunction;b.classList.toggle('active',b.dataset.view===currentView)}
}
function setMode(next){mode=next;renderStage();requestAnimationFrame(()=>viewer?.resize())}
function setView(view){currentView=view;isolated=false;viewer?.setView(view);renderStage()}
function openImage(source,title){$('dialog-image').src=source;$('dialog-image').alt=title;$('image-dialog-title').textContent=title;imageDialog.showModal()}
function goZone(zone){clearFilters();$('group-filter').value=zoneGroups[zone];renderList();selectItem(shown[0].code);mode='3d';setView(zone);renderStage();toast(zoneNames[zone]+' 구역의 품목을 표시합니다.')}

for(const a of document.querySelectorAll('[data-nav]'))a.addEventListener('click',e=>{e.preventDefault();if(a.dataset.nav==='equipment'){if(!selected)selectItem(shown[0]?.code||rows[0].code);else setPage('equipment')}else setPage(a.dataset.nav)});
$('search').addEventListener('input',filterChanged);$('group-filter').addEventListener('change',filterChanged);$('kind-filter').addEventListener('change',filterChanged);
$('clear-filters').addEventListener('click',()=>{clearFilters();filterChanged()});
$('browse-all').addEventListener('click',()=>{clearFilters();selectItem(rows[0].code)});
$('common-items').addEventListener('click',()=>{clearFilters();$('group-filter').value='공통구역 장비';renderList();selectItem(shown[0].code)});
$('service-items').addEventListener('click',()=>{clearFilters();$('kind-filter').value='service';renderList();selectItem(shown[0].code)});
$('mode-3d').addEventListener('click',()=>setMode('3d'));$('mode-image').addEventListener('click',()=>setMode('image'));
$('isolate').addEventListener('click',()=>{isolated=!isolated;viewer?.setIsolated(isolated);renderStage()});
$('zoom-in').addEventListener('click',()=>viewer?.zoom(1.25));$('zoom-out').addEventListener('click',()=>viewer?.zoom(.8));
$('expand-image').addEventListener('click',()=>openImage($('fallback-image').src,$('fallback-image').alt));
$('close-dialog').addEventListener('click',()=>imageDialog.close());
imageDialog.addEventListener('click',e=>{if(e.target===imageDialog){const box=imageDialog.getBoundingClientRect();if(e.clientX<box.left||e.clientX>box.right||e.clientY<box.top||e.clientY>box.bottom)imageDialog.close()}});
document.addEventListener('click',async e=>{
 const item=e.target.closest('[data-item]');if(item){selectItem(item.dataset.item);return}
 const zone=e.target.closest('[data-zone]');if(zone){goZone(zone.dataset.zone);return}
 const view=e.target.closest('[data-view]');if(view){setView(view.dataset.view);return}
 const imgView=e.target.closest('[data-image-view]');if(imgView){imageView=imgView.dataset.imageView;renderStage();return}
 const kind=e.target.closest('[data-kind]');if(kind){clearFilters();$('kind-filter').value=kind.dataset.kind;renderList();selectItem(shown[0].code);return}
 const step=e.target.closest('[data-step]');if(step){const idx=shown.findIndex(r=>r.code===selected)+Number(step.dataset.step);if(shown[idx])selectItem(shown[idx].code,{reveal:true});return}
 const action=e.target.closest('[data-action]')?.dataset.action;const r=byCode.get(selected);if(!action||!r)return;
 if(action==='focus'){setMode('3d');viewer?.focusSelection()}
 if(action==='isolated'){imageView='isolated';setMode('image')}
 if(action==='open-image')openImage(r.isolatedImage,`${r.code} ${r.name} · 분리 형상`);
 if(action==='print')window.print();
 if(action==='copy'){try{await navigator.clipboard.writeText(location.href);toast('선택한 품목의 링크를 복사했습니다.')}catch{toast('주소창의 링크를 복사하면 이 품목을 공유할 수 있습니다.')}}
});
document.addEventListener('keydown',e=>{if(e.key==='/'&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)&&!imageDialog.open){e.preventDefault();if(page!=='equipment')selectItem(rows[0].code);$('search').focus()}});
function restoreRoute(){const hash=location.hash.slice(1);if(hash.startsWith('item=')){const code=hash.slice(5);if(byCode.has(code)){selectItem(code,{clear:true});return}}setPage(['overview','equipment','scope'].includes(hash)?hash:'overview',{route:false});if(page==='equipment'&&!selected)selectItem(rows[0].code)}
window.addEventListener('hashchange',restoreRoute);
renderList();restoreRoute();

async function startModel(){
 try{
  const {createModelViewer}=await import('./model-viewer.js');
  viewer=await createModelViewer($('model-canvas'),{
   onSelect:codes=>{
    const valid=codes.filter(c=>byCode.has(c));if(valid.length===1)selectItem(valid[0],{reveal:true});
    else if(valid.length>1){$('pick-choice').hidden=false;$('pick-choice').innerHTML=`<p>이 외곽은 ${valid.length}개 품목이 공유합니다.<br>확인할 품목을 선택하세요.</p>${valid.map(c=>`<button data-item="${c}">${c} ${esc(byCode.get(c).name)}</button>`).join('')}`}
   },
   onStatus:state=>{
    if(state.state==='loading')$('loading-message').textContent=state.message+(state.progress!=null?` ${state.progress}%`:'');
    if(state.state==='ready'){viewerReady=true;isolated=state.isolated;currentView=state.view;renderStage()}
    if(state.state==='error'){viewerFailed=true;mode='image';$('model-loading').hidden=true;renderStage();toast('3D를 불러오지 못해 이미지로 표시합니다.')}
   }
  });
  viewer.select(selected);viewer.setView(currentView);renderStage();viewer.resize();
 }catch(error){viewerFailed=true;mode='image';renderStage();console.warn('3D unavailable; image view enabled.',error.message)}
}
startModel();
