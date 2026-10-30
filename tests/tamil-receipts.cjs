const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const box={exports:{}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('components/bill.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX}}).outputText,{module:box,exports:box.exports,require});
const {Bill}=box.exports;
const base={organization:'Test business',date:'2026-10-30',center:'MAIN',party:'Customer name',number:'TEST-001',total:150,paid:100,credit:50,status:'partially_paid',notes:'Original notes',lines:[{name:'Original product',quality:'Standard',quantity:3,unit:'KG',price:50,total:150}],payments:[{method:'cash',amount:100}]};
const print=(data)=>renderToStaticMarkup(React.createElement(Bill,{data:{...base,...data}}));
for(const title of ['PURCHASE BILL','PURCHASE RECEIPT','SALES INVOICE','SALES RECEIPT']){
 const html=print({title,language:'ta'});
 assert.match(html,/lang="ta"/);assert.match(html,/bill-tamil/);
 for(const label of ['ரசீது எண்','தேதி','மொத்தம் (LKR)','செலுத்திய தொகை','நிலுவைத் தொகை','பகுதியளவு செலுத்தப்பட்டது','கட்டண விவரங்கள்','பணம்','குறிப்புகள்','நன்றி'])assert.ok(html.includes(label),label);
 assert.ok(html.includes(title.includes('PURCHASE')?'வழங்குநர்':'வாடிக்கையாளர்'));
 assert.ok(html.includes(title==='SALES INVOICE'?'விற்பனை விலைப்பட்டியல்':title.includes('PURCHASE')?'கொள்முதல் ரசீது':'விற்பனை ரசீது'));
 for(const original of ['Original product','Customer name','Original notes','150.00','100.00','50.00','TEST-001'])assert.ok(html.includes(original),original);
}
const weighted=print({title:'PURCHASE BILL',language:'ta',lines:[{...base.lines[0],sacks:2},{...base.lines[0],quantity:2,sacks:1,total:100}],total:250});
for(const label of ['மொத்த மூட்டைகள்','மொத்த எடை','அலகு விலை','மொத்தத் தொகை','5 KG','250.00'])assert.ok(weighted.includes(label),label);
const draft=print({title:'PURCHASE BILL',language:'ta',draft:true,number:undefined});
assert.ok(draft.includes('வரைவு'));assert.ok(draft.includes('இன்னும் வழங்கப்படவில்லை'));assert.ok(!draft.includes('கட்டண விவரங்கள்'));
assert.ok(print({title:'CANCELLED SALES RECEIPT',language:'ta',status:'cancelled'}).includes('ரத்து செய்யப்பட்ட விற்பனை ரசீது'));
assert.ok(print({title:'SALES RECEIPT',language:'en'}).includes('Paid amount'));
assert.ok(print({title:'SALES RECEIPT',language:'si'}).includes('ගෙවූ මුදල'));
assert.match(print({title:'SALES RECEIPT'}),/lang="en"/);
for(const path of ['components/bill-detail.tsx','components/draft-bill.tsx','app/dashboard/sales/sales-receipt-preview.tsx','app/dashboard/purchases/new/purchase-form.tsx']){
 const code=fs.readFileSync(path,'utf8');assert.match(code,/set(?:Receipt)?Language\("ta"\)/,path);assert.ok(code.includes('தமிழ்'),path);
}
console.log('PASS Tamil purchase/sales/draft/cancelled receipts, weighted purchase grouping, unchanged amounts/master data, EN/SI fallback and all language selectors.');
