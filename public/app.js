const $ = id => document.getElementById(id);
const money = n => "₦" + Number(n || 0).toLocaleString("en-NG",{minimumFractionDigits:2});
const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
let selectedBatchId = null;
let editingWorkerId = null;
let workerCache = [];

async function api(url, options={}) {
  const res = await fetch(url, { headers: {"Content-Type":"application/json"}, ...options });
  const data = await res.json().catch(()=>({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

async function load() {
  const me = await api("/api/me");
  if (!me.user) return showLogin();
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
    <td>`<button class="secondary small-btn" data-edit="${w.id}">Edit</button> ${w.status==="active" ? `<button class="danger small-btn" data-deactivate="${w.id}">Deactivate</button>` : ""}`</td>
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

$("createBatch").onclick=async()=>{
  const name=prompt("Batch name:","September Payroll");
  if(!name)return;
  try{
    const created=await api("/api/batches",{method:"POST",body:JSON.stringify({batch_name:name,payment_date:new Date().toISOString().slice(0,10)})});
    await Promise.all([dashboard(),batches()]);
    await reviewBatch(created.id);
    alert("Batch created. Review it before payment.");
  }catch(e){alert(e.message);}
};

$("payAll").onclick=async()=>{
  if(!selectedBatchId){alert("Review a draft or failed batch first, then click Pay Selected Batch.");return;}
  const rows=await api("/api/batches");
  const batch=rows.find(b=>b.id===selectedBatchId);
  if(!batch){alert("Selected batch was not found.");return;}
  if(!["draft","failed","partially_failed"].includes(batch.status)){alert("This batch cannot be processed again.");return;}
  if(!confirm(`Process "${batch.batch_name}" for ${batch.total_workers} workers totaling ${money(batch.total_amount)}? This is sandbox mode.`))return;
  try{
    const r=await api("/api/payment-batches/"+batch.id+"/pay",{method:"POST"});
    await Promise.all([dashboard(),batches()]);
    await reviewBatch(batch.id);
    alert("Batch processed: "+r.status);
  }catch(e){alert(e.message);}
};

$("closeReview").onclick=()=>{$("batchReview").classList.add("hidden");selectedBatchId=null;batches();};
$("refreshWorkers").onclick=workers;
load().catch(()=>showLogin());
