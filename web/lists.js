const states=new Map();let workspace='';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const normalize=v=>String(v??'').normalize('NFD').replace(/\p{M}/gu,'').toLowerCase();
export function useListWorkspace(id){if(id!==workspace){workspace=id;states.clear();}}
export function listPage(id,items,text,scope=''){
 let state=states.get(id);if(!state){state={query:'',page:1,scope};states.set(id,state);}
 if(state.scope!==scope){state.scope=scope;state.page=1;}
 const query=normalize(state.query).trim().replace(/\s+/g,' ');
 const matches=query?items.filter(item=>normalize(text(item)).replace(/\s+/g,' ').includes(query)):items;
 const pages=Math.max(1,Math.ceil(matches.length/10));state.page=Math.min(pages,Math.max(1,state.page));
 const start=(state.page-1)*10;
 return {id,query:state.query,page:state.page,pages,total:items.length,count:matches.length,start,rows:matches.slice(start,start+10)};
}
export function listSearch(list,label,placeholder){return `<div class="list-search"><label for="list-search-${esc(list.id)}">${esc(label)}<input type="search" id="list-search-${esc(list.id)}" data-list-search="${esc(list.id)}" value="${esc(list.query)}" placeholder="${esc(placeholder||label)}" autocomplete="off"></label>${list.query?`<button type="button" data-list-clear="${esc(list.id)}" aria-label="Clear ${esc(label.toLowerCase())}">Clear</button>`:''}</div>`;}
export function listPager(list,label){return `<nav class="list-pager" aria-label="${esc(label)} pages"><span role="status">${list.count?`Showing ${list.start+1}–${list.start+list.rows.length} of ${list.count}`:'No matching entries'}${list.query?` (${list.total} total)`:''}</span><div><button type="button" data-list-page="${esc(list.id)}" data-number="${list.page-1}" aria-label="Previous ${esc(label)} page" ${list.page===1?'disabled':''}>Previous</button><span>Page ${list.page} of ${list.pages}</span><button type="button" data-list-page="${esc(list.id)}" data-number="${list.page+1}" aria-label="Next ${esc(label)} page" ${list.page===list.pages?'disabled':''}>Next</button></div></nav>`;}
export function bindLists(render,before=()=>{},disabled=()=>false){
 function refresh(focus){
  if(disabled())return;before();
  // Preserve unrelated in-progress forms when list controls redraw the page.
  const fields=[...document.querySelectorAll('form[id] input[name],form[id] select[name],form[id] textarea[name]')].filter(n=>!['password','file','hidden','submit','button'].includes(n.type)).map(n=>({form:n.form.id,name:n.name,value:n.value,checked:n.checked,type:n.type}));
  const details=[...document.querySelectorAll('details[id]')].map(n=>[n.id,n.open]);const x=scrollX,y=scrollY;
  render();
  for(const f of fields){const node=[...(document.getElementById(f.form)?.elements||[])].find(n=>n.name===f.name);if(node){node.value=f.value;if(['checkbox','radio'].includes(f.type))node.checked=f.checked;}}
  for(const [id,open]of details){const node=document.getElementById(id);if(node)node.open=open;}
  if(focus){const node=document.getElementById(focus.id);if(node){node.focus({preventScroll:true});if(focus.position!=null)node.setSelectionRange(focus.position,focus.position);}}
  window.scrollTo(x,y);
 }
 document.querySelectorAll('[data-list-search]').forEach(input=>input.oninput=()=>{if(disabled())return;const state=states.get(input.dataset.listSearch);state.query=input.value;state.page=1;refresh({id:input.id,position:input.selectionStart});});
 document.querySelectorAll('[data-list-clear]').forEach(button=>button.onclick=()=>{if(disabled())return;const state=states.get(button.dataset.listClear);state.query='';state.page=1;refresh({id:'list-search-'+button.dataset.listClear});});
 document.querySelectorAll('[data-list-page]').forEach(button=>button.onclick=()=>{if(disabled())return;const state=states.get(button.dataset.listPage);state.page=Number(button.dataset.number);refresh({id:`list-search-${button.dataset.listPage}`});});
}
