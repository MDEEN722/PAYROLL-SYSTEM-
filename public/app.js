const $ = id => document.getElementById(id);
const money = n => "₦" + Number(n || 0).toLocaleString("en-NG",{minimumFractionDigits:2});

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
  $("workersTable").innerHTML=rows.map(w=>`<tr><td>${w.first_name} ${w.last_name}</td><td>${w.account_name}<br><small>${w.account_number}</small></td><td>${money(w.salary)}</td><td><span class="status ${w.status}">${w.status}</span></td></tr>`).join("");
}

async function batches(){
  const rows=await api("/api/batches");
  $("batchesTable").innerHTML=rows.map(b=>`<tr><td>${b.batch_name}<br><small>${b.payment_date}</small></td><td>${b.total_workers}</td><td>${money(b.total_amount)}</td><td><span class="status ${b.status}">${b.status}</span></td></tr>`).join("");
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
  try{await api("/api/workers",{method:"POST",body:JSON.stringify(body)});e.target.reset();await Promise.all([dashboard(),workers()]);alert("Worker added successfully.");}catch(err){alert(err.message);}
});

$("createBatch").onclick=async()=>{
  const name=prompt("Batch name:","September Payroll");
  if(!name)return;
  try{await api("/api/batches",{method:"POST",body:JSON.stringify({batch_name:name,payment_date:new Date().toISOString().slice(0,10)})});await Promise.all([dashboard(),batches()]);alert("Batch created.");}catch(e){alert(e.message);}
};

$("payAll").onclick=async()=>{
  const rows=await api("/api/batches");
  const batch=rows.find(b=>b.status==="draft");
  if(!batch){alert("Create a payroll batch first.");return;}
  if(!confirm(`Pay all workers in "${batch.batch_name}"? This is sandbox mode.`))return;
  try{const r=await api("/api/payment-batches/"+batch.id+"/pay",{method:"POST"});await Promise.all([dashboard(),batches()]);alert("Batch processed: "+r.status);}catch(e){alert(e.message);}
};

$("refreshWorkers").onclick=workers;
load().catch(()=>showLogin());
