(function(){
  const ENGS = ["Kamol K.","Tananchai T.","Sippawit W.","Chirayut S.","Taskeen J.","Apisit S.","Kittipat Y.","Nontanan S.","Wuttikorn K.","Pratya P."];
  const SID = "1hW9Fpuil8y71ie6tV6e7Z3c7ViqwIRJAMnrkM0K-YYU";
  let curMth = "2026-10";

  function pHrs(t){ if(!t)return 0; const p=String(t).trim().split(":"); return (parseInt(p[0],10)||0)+(parseInt(p[1],10)||0)/60; }
  function fHrs(nh){ const nx=nh>=24, c=nx?nh-24:nh, m=Math.round(c*60), hh=String(Math.floor(m/60)%24).padStart(2,"0"), mm=String(m%60).padStart(2,"0"); return nx?hh+":"+mm+" (+1)":hh+":"+mm; }
  function addD(d,n){ const p=String(d).split("-").map(Number); if(!p[0])return d; return new Date(Date.UTC(p[0],p[1]-1,p[2]+n)).toISOString().slice(0,10); }
  function prepH(l,f){ const s=(l+" "+f).toLowerCase(); if(/asiangames|asian games|paragames|para games/.test(s))return 1; if(/thai league|chang fa cup|tl\/|tv5|fa cup/.test(String(l).toLowerCase()))return 4; return 2; }
  function enrich(r){
    const sh=pHrs(r.start), eh=pHrs(r.end), cut=sh<4, bd=cut?addD(r.date,-1):r.date;
    const ns=cut?sh+24:sh; let ne=cut?eh+24:eh; if(ne<=ns)ne+=24;
    const pr=prepH(r.name,r.feed); return Object.assign({},r,{bd,bm:String(bd).slice(0,7),ns,ne,pr,ci:ns-pr});
  }
  function getRecs(){ return (typeof records!=="undefined" && Array.isArray(records)) ? records : []; }

  function calcMth(list,eng,m){
    const evs=list.filter(e=>e.assign && e.assign.trim()!=="NOC VSS." && e.assign.includes(eng) && (m==="ALL"||e.bm===m));
    const byD={}; evs.forEach(e=>{(byD[e.bd]=byD[e.bd]||[]).push(e);});
    let dh=0,nh=0; const days=Object.keys(byD);
    days.forEach(d=>{
      const a=byD[d], er=a.filter(x=>x.ns<21), lt=a.filter(x=>x.ns>=21);
      const ee=er.length?Math.max(...er.map(x=>x.ne)):0, ls=lt.length?Math.min(...lt.map(x=>x.ns)):0;
      if(er.length && lt.length && ee<=21 && ls>=23){
        dh+=Math.max(0,ee-(Math.min(...er.map(x=>x.ns))-Math.max(...er.map(x=>x.pr))));
        nh+=Math.max(0,Math.max(...lt.map(x=>x.ne))-(ls-Math.max(...lt.map(x=>x.pr))));
      } else {
        const ts=Math.min(...a.map(x=>x.ns))-Math.max(...a.map(x=>x.pr)), te=Math.max(...a.map(x=>x.ne)), du=Math.max(0,te-ts);
        if(te>24||ts>=21) nh+=du; else dh+=du;
      }
    });
    return {dh:Math.round(dh*10)/10, nh:Math.round(nh*10)/10, th:Math.round((dh+nh)*10)/10, days:days.length};
  }

  window.syncAllSportsData = async function(){
    const btn = document.getElementById("syncAllSportsBtn");
    if(btn) btn.textContent = "⏳ กำลังดึงข้อมูลกีฬา...";
    try {
      const u = "https://docs.google.com/spreadsheets/d/"+SID+"/gviz/tq?tqx=out:json&sheet=Event%20Schedule";
      const res = await fetch(u); const txt = await res.text();
      const data = JSON.parse(txt.substring(txt.indexOf("{"), txt.lastIndexOf("}")+1));
      const rows = (data && data.table && data.table.rows) || [];
      let count = 0;
      const hasDb = typeof db !== "undefined" && db;
      let batch = hasDb ? db.batch() : null, op = 0;
      for(let i=0;i<rows.length;i++){
        const c = rows[i].c || [];
        const d = c[2]?(c[2].f||c[2].v):"", s = c[3]?(c[3].f||c[3].v):"", e = c[4]?(c[4].f||c[4].v):"";
        const g = c[5]?(c[5].v||""):"", l = c[6]?(c[6].v||""):"", ch = c[7]?(c[7].f||c[7].v||""):"", a = c[10]?(c[10].v||""):"";
        if(!d || !a || !String(a).trim()) continue;
        const item = { date:String(d).trim(), start:String(s||"").trim(), end:String(e||"").trim(), feed:String(g||"").trim(), name:String(l||"").trim(), channel:String(ch||"").trim(), assign:String(a).trim(), status:"Pass", isDeleted:false };
        if(hasDb){
          const id = (item.date+"_"+(item.channel||"CH")+"_"+(item.start||"00")).replace(/[^a-zA-Z0-9_-]/g,"_");
          batch.set(db.collection("feeds").doc(id), item, {merge:true});
          op++; if(op>=400){ await batch.commit(); batch=db.batch(); op=0; }
        } else if(typeof records!=="undefined"){
          records.push(item);
        }
        count++;
      }
      if(hasDb && op>0) await batch.commit();
      if(btn) btn.textContent = "✅ ดึงข้อมูลกีฬาสำเร็จ ("+count+")";
      setTimeout(()=>{ if(btn) btn.textContent="🔄 ดึงข้อมูลกีฬาทั้งหมด"; }, 3000);
      renderWk();
    } catch(err){
      if(btn) btn.textContent = "🔄 ดึงข้อมูลกีฬาทั้งหมด";
    }
  };

  window.renderWk = function(){
    const list = getRecs().map(enrich);
    let sd=0,sn=0,st=0,sdy=0;
    const mStats = ENGS.map(eng=>{ const r=calcMth(list,eng,curMth); sd+=r.dh; sn+=r.nh; st+=r.th; sdy+=r.days; return Object.assign({eng},r); });
    const elT = document.getElementById("wkKpiTot"); if(!elT) return;
    elT.textContent = st.toFixed(1)+" ชม.";
    document.getElementById("wkKpiDay").textContent = sd.toFixed(1)+" ชม.";
    document.getElementById("wkKpiNgt").textContent = sn.toFixed(1)+" ชม.";
    document.getElementById("wkKpiDays").textContent = sdy+" วัน";
    document.getElementById("wkMonthlyTbody").innerHTML = mStats.map(r=>`<tr><td><b>${r.eng}</b></td><td style="text-align:right">${r.dh.toFixed(1)}</td><td style="text-align:right">${r.nh.toFixed(1)}</td><td style="text-align:right"><b>${r.th.toFixed(1)}</b></td><td style="text-align:right">${r.days}</td><td style="text-align:right">${r.days?(r.th/r.days).toFixed(1):"0.0"}</td></tr>`).join("") + `<tr style="font-weight:800"><td>รวมทั้งหมด</td><td style="text-align:right">${sd.toFixed(1)}</td><td style="text-align:right">${sn.toFixed(1)}</td><td style="text-align:right">${st.toFixed(1)}</td><td style="text-align:right">${sdy}</td><td style="text-align:right">${sdy?(st/sdy).toFixed(1):"0.0"}</td></tr>`;

    const tStats = ENGS.map(eng=>({eng, s9:calcMth(list,eng,"2026-09").th, s10:calcMth(list,eng,"2026-10").th, s11:calcMth(list,eng,"2026-11").th, all:calcMth(list,eng,"ALL").th}));
    document.getElementById("wkTrendTbody").innerHTML = tStats.map(r=>`<tr><td><b>${r.eng}</b></td><td style="text-align:right">${r.s9.toFixed(1)}</td><td style="text-align:right">${r.s10.toFixed(1)}</td><td style="text-align:right">${r.s11.toFixed(1)}</td><td style="text-align:right"><b>${r.all.toFixed(1)}</b></td></tr>`).join("");

    const dt = document.getElementById("wkDateInp").value || "2026-10-24";
    const dEvs = list.filter(e=>e.bd===dt && e.assign && e.assign.trim()!=="NOC VSS.");
    document.getElementById("wkDailyContTbody").innerHTML = ENGS.map(eng=>{
      const my = dEvs.filter(e=>e.assign.includes(eng));
      if(!my.length) return `<tr style="opacity:0.5"><td>${eng}</td><td>OFF</td><td>—</td><td>—</td><td style="text-align:right">0.0 ชม.</td></tr>`;
      const mc=Math.min(...my.map(x=>x.ci)), me=Math.max(...my.map(x=>x.ne)), du=me-mc, sp=[...new Set(my.map(x=>x.name))].join(", ");
      return `<tr><td><b>${eng}</b></td><td>${sp}</td><td>${fHrs(mc)}</td><td>${fHrs(me)}</td><td style="text-align:right"><b>${du.toFixed(1)} ชม.</b></td></tr>`;
    }).join("");

    const spRows=[];
    ENGS.forEach(eng=>{
      const my=dEvs.filter(e=>e.assign.includes(eng));
      [...new Set(my.map(x=>x.name))].forEach(lg=>{
        const l=my.filter(x=>x.name===lg), ms=Math.min(...l.map(x=>x.ns)), me=Math.max(...l.map(x=>x.ne)), mc=Math.min(...l.map(x=>x.ci));
        spRows.push(`<tr><td><b>${eng}</b></td><td>${lg}</td><td>${fHrs(ms)} - ${fHrs(me)}</td><td>+${l[0].pr} ชม.</td><td>${fHrs(mc)} - ${fHrs(me)}</td><td style="text-align:right"><b>${(me-mc).toFixed(1)} ชม.</b></td></tr>`);
      });
    });
    document.getElementById("wkDailySportTbody").innerHTML = spRows.join("") || `<tr><td colspan="6" style="text-align:center">ไม่มีรายการในวันที่เลือก</td></tr>`;
  };

  window.addEventListener("DOMContentLoaded", ()=>{
    const nav = document.querySelector(".side-nav");
    if(nav && !nav.querySelector('[data-view="workload"]')){
      const b = document.createElement("button");
      b.className = "tab-btn side-tab-btn";
      b.dataset.view = "workload";
      b.innerHTML = "⏱️ ชั่วโมงทำงานวิศวกร";
      nav.insertBefore(b, nav.children[1] || null);
      b.addEventListener("click", ()=>{
        document.querySelectorAll(".tab-btn").forEach(x=>x.classList.remove("active"));
        document.querySelectorAll(".view").forEach(x=>x.classList.remove("active"));
        b.classList.add("active");
        const vw = document.getElementById("view-workload");
        if(vw) vw.classList.add("active");
        renderWk();
      });
    }
    const bulkBtn = document.getElementById("openBulkBtn");
    if(bulkBtn && !document.getElementById("syncAllSportsBtn")){
      const sb = document.createElement("button");
      sb.id = "syncAllSportsBtn"; sb.type = "button"; sb.className = "btn primary";
      sb.textContent = "🔄 ดึงข้อมูลกีฬาทั้งหมด";
      sb.onclick = window.syncAllSportsData;
      bulkBtn.parentNode.insertBefore(sb, bulkBtn);
    }
    const dash = document.getElementById("view-dashboard");
    if(dash && !document.getElementById("view-workload")){
      const sec = document.createElement("section");
      sec.id = "view-workload"; sec.className = "view";
      sec.innerHTML = `
        <div class="card" style="padding:18px;margin-bottom:16px;">
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:12px;">
            <h2 style="margin:0;font-size:18px;">⏱️ แดชบอร์ดชั่วโมงทำงานและตารางกะวิศวกร (10 คน — ไม่รวม NOC VSS.)</h2>
            <button type="button" class="btn primary sm" onclick="window.syncAllSportsData()">🔄 ดึงข้อมูลกีฬาทั้งหมด</button>
          </div>
          <div class="seg" id="wkSubNav" style="display:flex;gap:6px;flex-wrap:wrap;">
            <button type="button" class="btn sm primary" data-wk="mth">📅 1. สรุปชั่วโมงรายเดือน</button>
            <button type="button" class="btn sm" data-wk="trd">📈 2. แนวโน้มหลายเดือน</button>
            <button type="button" class="btn sm" data-wk="cnt">⏰ 3. ตารางกะรายวัน (ยิงยาว)</button>
            <button type="button" class="btn sm" data-wk="spt">🏆 4. แจกแจงตามฟีดกีฬา</button>
          </div>
        </div>
        <div id="wk-p-mth" class="wk-pane">
          <div class="card" style="padding:16px;margin-bottom:16px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
            <b>เลือกเดือน:</b>
            <button type="button" class="btn sm wk-m-btn" data-m="2026-09">ก.ย. 2026</button>
            <button type="button" class="btn sm primary wk-m-btn" data-m="2026-10">ต.ค. 2026</button>
            <button type="button" class="btn sm wk-m-btn" data-m="2026-11">พ.ย. 2026</button>
            <button type="button" class="btn sm wk-m-btn" data-m="ALL">รวมทุกเดือน</button>
            <span style="margin-left:auto;font-size:12px;opacity:0.75;">รวมเวลาทำงาน: <b id="wkKpiTot">0</b> | กลางวัน: <b id="wkKpiDay">0</b> | กะดึก: <b id="wkKpiNgt">0</b> | วันทำงาน: <b id="wkKpiDays">0</b></span>
          </div>
          <div class="card" style="padding:16px;"><table class="data-table" style="width:100%"><thead><tr><th>Engineer</th><th style="text-align:right">Day (ชม.)</th><th style="text-align:right">Night (ชม.)</th><th style="text-align:right">รวม (ชม.)</th><th style="text-align:right">วันทำงาน</th><th style="text-align:right">เฉลี่ย ชม./วัน</th></tr></thead><tbody id="wkMonthlyTbody"></tbody></table></div>
        </div>
        <div id="wk-p-trd" class="wk-pane" style="display:none;">
          <div class="card" style="padding:16px;"><table class="data-table" style="width:100%"><thead><tr><th>Engineer</th><th style="text-align:right">ก.ย. 2026</th><th style="text-align:right">ต.ค. 2026</th><th style="text-align:right">พ.ย. 2026</th><th style="text-align:right">รวมสะสม (ชม.)</th></tr></thead><tbody id="wkTrendTbody"></tbody></table></div>
        </div>
        <div id="wk-p-cnt" class="wk-pane" style="display:none;">
          <div class="card" style="padding:16px;margin-bottom:14px;"><b>เลือกวันที่ (ตัดกะ 04:00 น.):</b> <input type="date" id="wkDateInp" value="2026-10-24" onchange="window.renderWk()"></div>
          <div class="card" style="padding:16px;"><table class="data-table" style="width:100%"><thead><tr><th>Engineer</th><th>รายการกีฬาที่ดูแล</th><th>เวลาเข้างาน</th><th>เวลาเลิกงาน</th><th style="text-align:right">รวมชั่วโมง</th></tr></thead><tbody id="wkDailyContTbody"></tbody></table></div>
        </div>
        <div id="wk-p-spt" class="wk-pane" style="display:none;">
          <div class="card" style="padding:16px;"><table class="data-table" style="width:100%"><thead><tr><th>Engineer</th><th>ลีกกีฬา</th><th>เวลาถ่ายทอดสด</th><th>เตรียมงาน</th><th>เวลาปฏิบัติงานจริง</th><th style="text-align:right">รวมชั่วโมง</th></tr></thead><tbody id="wkDailySportTbody"></tbody></table></div>
        </div>
      `;
      dash.parentNode.insertBefore(sec, dash.nextSibling);
      sec.querySelectorAll("[data-wk]").forEach(btn=>{
        btn.addEventListener("click", ()=>{
          sec.querySelectorAll("[data-wk]").forEach(x=>x.classList.remove("primary"));
          btn.classList.add("primary");
          sec.querySelectorAll(".wk-pane").forEach(p=>p.style.display = p.id==="wk-p-"+btn.dataset.wk ? "block" : "none");
          renderWk();
        });
      });
      sec.querySelectorAll(".wk-m-btn").forEach(btn=>{
        btn.addEventListener("click", ()=>{
          curMth = btn.dataset.m;
          sec.querySelectorAll(".wk-m-btn").forEach(x=>x.classList.remove("primary"));
          btn.classList.add("primary");
          renderWk();
        });
      });
    }
    setInterval(renderWk, 3000);
  });
})();
