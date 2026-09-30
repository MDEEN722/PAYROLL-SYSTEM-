const $ = id => document.getElementById(id);
const money = n => "₦" + Number(n || 0).toLocaleString("en-NG",{minimumFractionDigits:2});
const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
let selectedBatchId = null;
let editingWorkerId = null;
let workerCache = [];
let currentUser = null;
let selectedWorkerIds = new Set();

async function api(url, options={}) {
  const res = await fetch(url, { headers: {"Content-Type":"application/json"}, ...options });
  const data = await res.json().catch(()=>({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

async function load() {
  const me = await api("/api/me");
  if (!me.user) return showLogin();
  currentUser=me.user;
  $("currentUser").textContent=`${me.user.name} • ${me.user.role}`;
  $("auditButton").classList.toggle("hidden",me.user.role!=="admin");
  $("usersButton").classList.toggle("hidden",me.user.role!=="admin");
  $("payAll").classList.toggle("hidden",me.user.role!=="admin");
  $("login").classList.add("hidden");
  $("app").classList.remove("hidden");
  await Promise.all([dashboard(), workers(), batches()]);
}

function showLogin(){ $("login").classList.remove("hidden"); $("app").classList.add("hidden"); }

async function dashboard(){
  const d = await api("/api/dashboard");
  $("workersCount").textContent=d.workers;
  $("batchesCount").textContent=d.batches;
  $("paidTotal").textContent=money(d.paid);
  $("pendingCount").textContent=d.pending;
}

async function workers(){
  const rows=await api("/api/workers");
  workerCache=rows;
  $("workersTable").innerHTML=rows.length ? rows.map(w=>`<tr>
    <td>${escapeHtml(w.first_name)} ${escapeHtml(w.last_name)}</td>
    <td>${escapeHtml(w.account_name)}<br><small>${escapeHtml(w.account_number)}</small></td>
    <td>${money(w.salary)}</td>
    <td><span class="status ${escapeHtml(w.status)}">${escapeHtml(w.status)}</span></td>
    <td><button class="secondary small-btn" data-edit="${w.id}">Edit</button> ${w.status==="active" && currentUser?.role==="admin" ? `<button class="danger small-btn" data-deactivate="${w.id}">Deactivate</button>` : ""}</td>
  </tr>`).join("") : '<tr><td colspan="5" class="empty">No workers yet.</td></tr>';
}

async function batches(){
  const rows=await api("/api/batches");
  $("batchesTable").innerHTML=rows.length ? rows.map(b=>`<tr class="${Number(selectedBatchId)===b.id ? "selected-row" : ""}">
    <td>${escapeHtml(b.batch_name)}<br><small>${escapeHtml(b.payment_date)}</small></td>
    <td>${b.total_workers}</td>
    <td>${money(b.total_amount)}</td>
    <td><span class="status ${escapeHtml(b.status)}">${escapeHtml(b.status)}</span></td>
    <td><button class="secondary small-btn" data-review="${b.id}">Review</button></td>
  </tr>`).join("") : '<tr><td colspan="5" class="empty">No payment batches yet.</td></tr>';
}

async function reviewBatch(id){
  selectedBatchId=Number(id);
  const all=await api("/api/batches");
  const batch=all.find(b=>b.id===selectedBatchId);
  const rows=await api(`/api/batches/${selectedBatchId}/payments`);
  $("reviewTitle").textContent=batch ? batch.batch_name : "Batch Review";
  $("reviewMeta").textContent=batch ? `${batch.total_workers} workers • ${money(batch.total_amount)} • ${batch.status}` : "";
  $("submitApproval").classList.toggle("hidden",!batch || batch.status!=="draft");
  $("approveBatch").classList.toggle("hidden",!batch || batch.status!=="pending_approval" || currentUser?.role!=="admin");
  $("rejectBatch").classList.toggle("hidden",!batch || batch.status!=="pending_approval" || currentUser?.role!=="admin");
  $("payAll").classList.toggle("hidden",currentUser?.role!=="admin" || !batch || !["approved","failed","partially_failed"].includes(batch.status));
  $("paymentsTable").innerHTML=rows.map(p=>`<tr>
    <td>${escapeHtml(p.first_name)} ${escapeHtml(p.last_name)}</td>
    <td>${escapeHtml(p.account_name)}</td>
    <td>${money(p.amount)}</td>
    <td><span class="status ${escapeHtml(p.status)}">${escapeHtml(p.status)}</span></td>
    <td><small>${escapeHtml(p.provider_reference || p.failure_reason || "—")}</small></td>
  </tr>`).join("");
  $("batchReview").classList.remove("hidden");
  await batches();
  $("batchReview").scrollIntoView({behavior:"smooth",block:"start"});
}

$("loginForm").addEventListener("submit", async e=>{
  e.preventDefault();
  try { await api("/api/login",{method:"POST",body:JSON.stringify({email:$("email").value,password:$("password").value})}); $("loginError").textContent=""; await load(); }
  catch(e){ $("loginError").textContent=e.message; }
});

$("logout").onclick=async()=>{await api("/api/logout",{method:"POST"});showLogin();};

$("workerForm").addEventListener("submit", async e=>{
  e.preventDefault();
  const body={first_name:$("first_name").value,last_name:$("last_name").value,email:$("emailW").value,phone:$("phone").value,bank_code:$("bank_code").value,account_number:$("account_number").value,account_name:$("account_name").value,salary:Number($("salary").value)};
  try{
    if(editingWorkerId) await api("/api/workers/"+editingWorkerId,{method:"PUT",body:JSON.stringify(body)});
    else await api("/api/workers",{method:"POST",body:JSON.stringify(body)});
    const message=editingWorkerId ? "Worker updated successfully." : "Worker added successfully.";
    resetWorkerForm(); await Promise.all([dashboard(),workers()]); alert(message);
  }catch(err){alert(err.message);}
});

function resetWorkerForm(){
  editingWorkerId=null; $("workerForm").reset(); $("account_number").placeholder="10-digit account number"; $("workerSubmit").textContent="Add Worker"; $("cancelEdit").classList.add("hidden");
}
$("cancelEdit").onclick=resetWorkerForm;

$("workersTable").addEventListener("click", async e=>{
  const editId=e.target.dataset.edit;
  if(editId){
    const w=workerCache.find(x=>x.id===Number(editId));
    if(!w)return;
    editingWorkerId=w.id;
    $("first_name").value=w.first_name; $("last_name").value=w.last_name; $("emailW").value=w.email||""; $("phone").value=w.phone||"";
    $("bank_code").value=w.bank_code; $("account_number").value=""; $("account_name").value=w.account_name; $("salary").value=w.salary;
    $("account_number").placeholder="Re-enter 10-digit account number";
    $("workerSubmit").textContent="Save Changes"; $("cancelEdit").classList.remove("hidden"); $("first_name").focus();
    return;
  }
  const id=e.target.dataset.deactivate;
  if(!id)return;
  if(!confirm("Deactivate this worker? They will be excluded from future payroll batches."))return;
  try{await api(`/api/workers/${id}/deactivate`,{method:"PATCH"});await Promise.all([dashboard(),workers()]);}catch(err){alert(err.message);}
});

$("batchesTable").addEventListener("click", e=>{
  const id=e.target.dataset.review;
  if(id) reviewBatch(id).catch(err=>alert(err.message));
});

function updateSelectionSummary(){
  const chosen=workerCache.filter(w=>selectedWorkerIds.has(w.id));
  $("selectionSummary").textContent=`${chosen.length} selected • ${money(chosen.reduce((sum,w)=>sum+Number(w.salary),0))}`;
}
function renderBatchPicker(){
  const active=workerCache.filter(w=>w.status==="active");
  $("batchWorkerList").innerHTML=active.length ? active.map(w=>`<label class="picker-row"><input type="checkbox" data-pick-worker="${w.id}" ${selectedWorkerIds.has(w.id)?"checked":""}><span><strong>${escapeHtml(w.first_name)} ${escapeHtml(w.last_name)}</strong><small>${escapeHtml(w.account_name)} • ${money(w.salary)}</small></span></label>`).join("") : '<p class="empty">No active workers available.</p>';
  updateSelectionSummary();
}
$("createBatch").onclick=async()=>{
  await workers();
  selectedWorkerIds=new Set(workerCache.filter(w=>w.status==="active").map(w=>w.id));
  renderBatchPicker();
  $("batchBuilder").classList.remove("hidden");
};
$("batchWorkerList").addEventListener("change",e=>{
  const id=Number(e.target.dataset.pickWorker); if(!id)return;
  if(e.target.checked)selectedWorkerIds.add(id);else selectedWorkerIds.delete(id);
  updateSelectionSummary();
});
$("selectAllWorkers").onclick=()=>{selectedWorkerIds=new Set(workerCache.filter(w=>w.status==="active").map(w=>w.id));renderBatchPicker();};
$("clearWorkers").onclick=()=>{selectedWorkerIds.clear();renderBatchPicker();};
$("cancelBatch").onclick=()=>{$("batchBuilder").classList.add("hidden");selectedWorkerIds.clear();};
$("confirmBatch").onclick=async()=>{
  if(!selectedWorkerIds.size){alert("Select at least one worker.");return;}
  const name=prompt("Batch name:","September Payroll"); if(!name)return;
  try{
    const created=await api("/api/batches",{method:"POST",body:JSON.stringify({batch_name:name,payment_date:new Date().toISOString().slice(0,10),worker_ids:[...selectedWorkerIds]})});
    $("batchBuilder").classList.add("hidden"); selectedWorkerIds.clear();
    await Promise.all([dashboard(),batches()]); await reviewBatch(created.id);
    alert("Batch created with the selected workers.");
  }catch(e){alert(e.message);}
};

$("payAll").onclick=async()=>{
  if(!selectedBatchId){alert("Review a draft or failed batch first, then click Pay Selected Batch.");return;}
  const rows=await api("/api/batches");
  const batch=rows.find(b=>b.id===selectedBatchId);
  if(!batch){alert("Selected batch was not found.");return;}
  if(!["approved","failed","partially_failed"].includes(batch.status)){alert("This batch must be approved before payment.");return;}
  if(!confirm(`Process "${batch.batch_name}" for ${batch.total_workers} workers totaling ${money(batch.total_amount)}? This is sandbox mode.`))return;
  try{
    const r=await api("/api/payment-batches/"+batch.id+"/pay",{method:"POST"});
    await Promise.all([dashboard(),batches()]);
    await reviewBatch(batch.id);
    alert("Batch processed: "+r.status);
  }catch(e){alert(e.message);}
};

async function batchAction(action){
  if(!selectedBatchId)return;
  try{
    await api(`/api/batches/${selectedBatchId}/${action}`,{method:"POST"});
    await Promise.all([dashboard(),batches()]);
    await reviewBatch(selectedBatchId);
  }catch(e){alert(e.message);}
}
$("submitApproval").onclick=()=>{if(confirm("Submit this payroll batch for administrator approval?"))batchAction("submit");};
$("approveBatch").onclick=()=>{if(confirm("Approve this payroll batch for payment?"))batchAction("approve");};
$("rejectBatch").onclick=()=>{if(confirm("Reject this batch and return it to draft?"))batchAction("reject");};
$("closeReview").onclick=()=>{$("batchReview").classList.add("hidden");selectedBatchId=null;$("payAll").classList.add("hidden");batches();};

$("passwordButton").onclick=async()=>{
  const current=prompt("Current password:"); if(current===null)return;
  const next=prompt("New password (10+ characters):"); if(next===null)return;
  try{await api("/api/change-password",{method:"POST",body:JSON.stringify({current_password:current,new_password:next})});alert("Password changed successfully.");}catch(e){alert(e.message);}
};

async function loadUsers(){
  const rows=await api("/api/users");
  $("usersTable").innerHTML=rows.map(u=>`<tr><td>${escapeHtml(u.name)}</td><td>${escapeHtml(u.email)}</td><td><span class="status">${escapeHtml(u.role)}</span></td><td><span class="status ${escapeHtml(u.status)}">${escapeHtml(u.status)}</span></td><td>${escapeHtml(u.created_at)}</td><td>${u.id===currentUser.id ? "Current user" : `<button class="secondary small-btn" data-role-user="${u.id}" data-role="${u.role==="admin"?"payroll_officer":"admin"}">Make ${u.role==="admin"?"Payroll Officer":"Admin"}</button> <button class="secondary small-btn" data-reset-user="${u.id}">Reset Password</button> <button class="${u.status==="active"?"danger":"secondary"} small-btn" data-status-user="${u.id}" data-status="${u.status==="active"?"inactive":"active"}">${u.status==="active"?"Deactivate":"Activate"}</button>`}</td></tr>`).join("");
}
$("usersButton").onclick=async()=>{try{await loadUsers();$("usersPanel").classList.remove("hidden");$("usersPanel").scrollIntoView({behavior:"smooth"});}catch(e){alert(e.message);}};
$("closeUsers").onclick=()=>$("usersPanel").classList.add("hidden");
$("userForm").addEventListener("submit",async e=>{
  e.preventDefault();
  try{
    await api("/api/users",{method:"POST",body:JSON.stringify({name:$("userName").value,email:$("userEmail").value,password:$("userPassword").value,role:$("userRole").value})});
    e.target.reset(); await loadUsers(); alert("User created successfully.");
  }catch(err){alert(err.message);}
});
$("usersTable").addEventListener("click",async e=>{
  const resetId=e.target.dataset.resetUser;
  if(resetId){
    const password=prompt("New temporary password (10+ characters):"); if(!password)return;
    try{await api(`/api/users/${resetId}/reset-password`,{method:"POST",body:JSON.stringify({password})});alert("Password reset successfully.");}catch(err){alert(err.message);} return;
  }
  const statusId=e.target.dataset.statusUser, status=e.target.dataset.status;
  if(statusId){
    if(!confirm(`${status==="inactive"?"Deactivate":"Activate"} this user?`))return;
    try{await api(`/api/users/${statusId}/status`,{method:"PATCH",body:JSON.stringify({status})});await loadUsers();}catch(err){alert(err.message);} return;
  }
  const id=e.target.dataset.roleUser, role=e.target.dataset.role;
  if(!id)return;
  if(!confirm(`Change this user's role to ${role}?`))return;
  try{await api(`/api/users/${id}/role`,{method:"PATCH",body:JSON.stringify({role})});await loadUsers();}catch(err){alert(err.message);}
});

$("reportsButton").onclick=async()=>{
  try{
    const rows=await api("/api/reports/payroll");
    $("reportsTable").innerHTML=rows.length ? rows.map(r=>`<tr><td>${escapeHtml(r.batch_name)}</td><td>${escapeHtml(r.payment_date)}</td><td>${r.total_workers}</td><td>${money(r.paid_amount)}</td><td>${r.success_count||0}</td><td>${r.failed_count||0}</td><td>${r.pending_count||0}</td><td><span class="status ${escapeHtml(r.status)}">${escapeHtml(r.status)}</span></td></tr>`).join("") : '<tr><td colspan="8" class="empty">No payroll history yet.</td></tr>';
    $("reportsPanel").classList.remove("hidden");
    $("reportsPanel").scrollIntoView({behavior:"smooth",block:"start"});
  }catch(e){alert(e.message);}
};
$("closeReports").onclick=()=>$("reportsPanel").classList.add("hidden");

$("auditButton").onclick=async()=>{
  try{
    const rows=await api("/api/audit-logs");
    $("auditTable").innerHTML=rows.length ? rows.map(x=>`<tr><td>${escapeHtml(x.created_at)}</td><td>${escapeHtml(x.name||"System")}</td><td>${escapeHtml(x.action)}</td><td>${escapeHtml(x.details||"—")}</td></tr>`).join("") : '<tr><td colspan="4" class="empty">No audit events yet.</td></tr>';
    $("auditPanel").classList.remove("hidden");
    $("auditPanel").scrollIntoView({behavior:"smooth",block:"start"});
  }catch(e){alert(e.message);}
};
$("closeAudit").onclick=()=>$("auditPanel").classList.add("hidden");
$("refreshWorkers").onclick=workers;
load().catch(()=>showLogin());
