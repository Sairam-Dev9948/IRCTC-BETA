(() => {
  'use strict';

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const norm = v => String(v ?? '').toLowerCase().replace(/[*:]/g,'').replace(/\s+/g,' ').trim();

  const rendered = el => {
    if (!el) return false;
    const s = getComputedStyle(el);
    return s.display !== 'none' && s.visibility !== 'hidden' && el.getClientRects().length > 0;
  };
  const visible = el => Boolean(el && !el.disabled && !el.readOnly && rendered(el));

  function textOf(el) {
    if (!el) return '';
    const bits = [el.innerText, el.textContent, el.value, el.getAttribute('aria-label'), el.getAttribute('placeholder'), el.getAttribute('name'), el.getAttribute('formcontrolname'), el.getAttribute('ng-reflect-name'), el.getAttribute('id'), el.getAttribute('data-testid')];
    if (el.labels) bits.push(...[...el.labels].map(x => x.textContent));
    const labelled = el.getAttribute('aria-labelledby');
    if (labelled) bits.push(...labelled.split(/\s+/).map(id => document.getElementById(id)?.textContent || ''));
    const parentLabel = el.closest('label');
    if (parentLabel) bits.push(parentLabel.textContent);
    const container = el.closest('mat-form-field,.form-group,.field,.p-field,.form-control-container,.passenger-form-field');
    if (container) bits.push(container.textContent);
    return norm(bits.filter(Boolean).join(' '));
  }

  function candidates(scope, selector='input,select,textarea,[role="combobox"],[aria-haspopup="listbox"],mat-select,button,[role="button"],[role="radio"]') {
    return [...scope.querySelectorAll(selector)].filter(visible);
  }

  function setNativeValue(el, value) {
    if (!el) return false;
    const v = String(value ?? '');
    try {
      const proto = el instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : el instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) setter.call(el, v); else el.value = v;
    } catch (_) { el.value = v; }
    try { el.dispatchEvent(new InputEvent('input', {bubbles:true, inputType:'insertText', data:v})); } catch (_) { el.dispatchEvent(new Event('input',{bubbles:true})); }
    el.dispatchEvent(new Event('change',{bubbles:true}));
    el.dispatchEvent(new Event('blur',{bubbles:true}));
    return el.value === v;
  }

  function field(scope, keys, fallbackIndex=-1) {
    const all = candidates(scope, 'input:not([type="hidden"]),textarea,select,[role="combobox"],[aria-haspopup="listbox"],mat-select');
    const found = all.find(el => keys.some(k => textOf(el).includes(norm(k))));
    return found || (fallbackIndex >= 0 ? all[fallbackIndex] : null);
  }

  function findLabeledControl(scope, labels, wanted, type) {
    const labelNames = labels.map(norm);
    const labelNodes = [...scope.querySelectorAll('label,span,div,p,strong')]
      .filter(el => visible(el) && labelNames.includes(norm(el.innerText || el.textContent)))
      .sort((a,b)=>(a.innerText||a.textContent||'').length-(b.innerText||b.textContent||'').length);

    for (const label of labelNodes) {
      if (label.matches('label[for]')) {
        const associated=document.getElementById(label.htmlFor);
        if(associated && visible(associated)) return associated;
      }

      let container=label.parentElement;
      for(let depth=0;depth<5 && container && container!==scope;depth++,container=container.parentElement){
        const rect=container.getBoundingClientRect();
        if(rect.width>700 || rect.height>250) continue;

        const controls=[...container.querySelectorAll(
          'select,[role="combobox"],[aria-haspopup="listbox"],button,[role="button"],input,mat-select,[tabindex]'
        )].filter(el=>visible(el)&&!el.contains(label));
        const labelled=controls.find(el=>{
          const attrs=norm([el.getAttribute('aria-label'),el.getAttribute('name'),
            el.getAttribute('formcontrolname'),el.getAttribute('placeholder')].filter(Boolean).join(' '));
          return labelNames.some(name=>attrs===name||attrs.includes(name));
        });
        if(labelled) return labelled;

        const labelRect=label.getBoundingClientRect();
        const nearby=controls.map(el=>{
          const elRect=el.getBoundingClientRect();
          const text=norm([el.innerText,el.textContent,el.value].filter(Boolean).join(' '));
          const state=text==='select' || Boolean(wanted&&type&&optionMatches(text,el.value,wanted,type));
          const aligned=elRect.left>=labelRect.left-8 && elRect.top>=labelRect.top-8 &&
            elRect.top-labelRect.bottom<100 && elRect.left-labelRect.right<500;
          return {el,state,aligned,area:elRect.width*elRect.height};
        }).filter(item=>item.state&&item.aligned)
          .sort((a,b)=>Number(b.state)-Number(a.state)||a.area-b.area);
        if(nearby.length) return nearby[0].el;

        const text=norm(container.innerText||container.textContent);
        if(labelNames.some(name=>text.includes(name)) &&
          (/\bselect\b/.test(text)||(wanted&&type&&optionMatches(text,'',wanted,type)))) {
          const textNodes=[...container.querySelectorAll('span,div,button,[role="button"],[tabindex]')]
            .filter(el=>{
              if(!visible(el)||el.contains(label)) return false;
              const value=norm(el.innerText||el.textContent||el.value);
              return value==='select'||Boolean(wanted&&type&&optionMatches(value,el.value,wanted,type));
            })
            .sort((a,b)=>(a.innerText||a.textContent||'').length-(b.innerText||b.textContent||'').length);
          if(textNodes.length) return textNodes[0];
        }
      }
    }
    return null;
  }

  function click(el) {
    if (!el || !visible(el)) return false;
    try { el.scrollIntoView({block:'center',inline:'nearest'}); } catch (_) {}
    try { el.focus({preventScroll:true}); } catch (_) { try { el.focus(); } catch (_) {} }
    el.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true,view:window}));
    el.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,cancelable:true,view:window}));
    el.click();
    return true;
  }

  async function waitFor(fn, timeout=8000, interval=100) {
    const start = Date.now();
    while (Date.now()-start < timeout) {
      try { const x = fn(); if (x) return x; } catch (_) {}
      await sleep(interval);
    }
    return null;
  }

  function findButton(words, scope=document) {
    const wanted = words.map(norm);
    return candidates(scope,'button,a,[role="button"],input[type="button"],input[type="submit"],mat-button,span').sort((a,b)=>textOf(a).length-textOf(b).length).find(el => {
      const t=textOf(el);
      return wanted.some(w => t===w || t.includes(w));
    }) || null;
  }

  function findNewPassenger() {
    return findButton(['new passenger','add passenger','+ new passenger']);
  }

  function findPassengerDialog() {
    const scopes = [
      ...candidates(document,'[role="dialog"],mat-dialog-container,.cdk-overlay-pane,.modal,.p-dialog'),
      ...candidates(document,'.passenger-form,.passenger-details,.traveller-form')
    ];
    return scopes.find(s => /passenger|traveller/.test(textOf(s)) && candidates(s,'input:not([type="hidden"]),select,textarea,[role="combobox"],mat-select').length) || scopes.find(s=>candidates(s,'input:not([type="hidden"]),select,textarea').length) || null;
  }

  function choiceValue(value, type) {
    const text = norm(value);
    if (type === 'gender') {
      if (/\bfemale\b|\bf\b/.test(text)) return 'female';
      if (/\bmale\b|\bm\b/.test(text)) return 'male';
      if (/\btrans(?:gender)?\b/.test(text)) return 'transgender';
      return '';
    }
    if (type === 'berth') {
      if (/side\s*lower|\bsl\b/.test(text)) return 'side lower';
      if (/side\s*upper|\bsu\b/.test(text)) return 'side upper';
      if (/no preference|\bnone\b|\bnp\b/.test(text)) return 'no preference';
      if (/\bmiddle\b|\bmb\b/.test(text)) return 'middle';
      if (/\blower\b|\blb\b/.test(text)) return 'lower';
      if (/\bupper\b|\bub\b/.test(text)) return 'upper';
      return '';
    }
    return text;
  }

  function choiceText(el) {
    const bits = [el.value, el.getAttribute('aria-label'), el.getAttribute('title')];
    if (el.matches('label')) {
      bits.push(el.textContent);
    } else {
      bits.push(el.innerText || el.textContent);
    }
    if (el.labels) bits.push(...[...el.labels].map(label => label.textContent));
    const parentLabel = el.closest('label');
    if (parentLabel) bits.push(parentLabel.textContent);
    return norm(bits.filter(Boolean).join(' '));
  }

  function optionMatches(optionText, optionValue, wanted, type) {
    if (type === 'gender' || type === 'berth') {
      const expected = choiceValue(wanted, type);
      return Boolean(expected) &&
        (choiceValue(optionText, type) === expected || choiceValue(optionValue, type) === expected);
    }
    const text = norm(optionText);
    const value = norm(optionValue);
    const expected = norm(wanted);
    return text === expected || value === expected || text.includes(expected) || value.includes(expected);
  }

  function controlMatchesChoice(el,wanted,type) {
    if(!el) return false;
    const expected=choiceValue(wanted,type);
    const values=el.tagName==='SELECT'
      ? [el.value,el.selectedOptions[0]?.text]
      : [el.value,el.innerText,el.textContent,el.getAttribute('aria-label'),el.getAttribute('title')];
    if(values.some(value=>choiceValue(value,type)===expected)) return true;

    return type==='berth' && expected==='no preference' &&
      values.some(value=>/^(?:select|choose|--select--|select berth preference)$/.test(norm(value)));
  }

  function findDropdownOption(wanted,type,trigger) {
    let options=[...document.querySelectorAll(
      '[role="option"],mat-option,.mat-option,.mat-mdc-option,.ng-option,.dropdown-item,'+
      '[class*="option" i],[data-value],li,button,[role="menuitem"],a,div,span'
    )].filter(el=>visible(el)&&optionMatches(
      el.innerText||el.textContent,
      el.getAttribute('data-value')||el.value,
      wanted,
      type
    ));
    if(trigger){
      const popupIds=[trigger.getAttribute('aria-controls'),trigger.getAttribute('aria-owns')]
        .filter(Boolean).flatMap(value=>value.split(/\s+/));
      const popups=popupIds.map(id=>document.getElementById(id)).filter(Boolean);
      if(popups.length){
        const controlled=options.filter(option=>popups.some(popup=>popup===option||popup.contains(option)));
        if(controlled.length) options=controlled;
      }else{
        const menuOptions=options.filter(option=>option.closest(
          '[role="listbox"],[role="menu"],.cdk-overlay-pane,.dropdown-menu,[class*="options" i]'
        ));
        if(menuOptions.length){
          options=menuOptions;
        }else{
          const triggerRect=trigger.getBoundingClientRect();
          options=options.filter(option=>{
            const rect=option.getBoundingClientRect();
            const verticalGap=Math.max(0,triggerRect.top-rect.bottom,rect.top-triggerRect.bottom);
            const horizontalGap=Math.max(0,triggerRect.left-rect.right,rect.left-triggerRect.right);
            return verticalGap<=400&&horizontalGap<=300;
          });
        }
      }
    }
    const leaves=options.filter(option=>!options.some(child=>child!==option&&option.contains(child)));
    return leaves.sort((a,b)=>{
      const priority=el=>el.matches(
        '[role="option"],mat-option,.mat-option,.mat-mdc-option,.ng-option,.dropdown-item,'+
        '[data-value],li,button,[role="menuitem"],a'
      )?0:1;
      return priority(a)-priority(b) ||
        (a.innerText||a.textContent||'').length-(b.innerText||b.textContent||'').length;
    })[0]||null;
  }

  function clickDropdownOption(option) {
    if(!option) return false;
    const target=option.closest(
      'button,a,[role="option"],[role="menuitem"],[class*="option" i],[data-value],li'
    )||option;
    if(!visible(target)) return false;
    try{target.scrollIntoView({block:'nearest',inline:'nearest'});}catch(_){}
    try{
      const rect=target.getBoundingClientRect();
      const x=rect.left+rect.width/2;
      const y=rect.top+rect.height/2;
      target.dispatchEvent(new PointerEvent('pointerdown',{
        bubbles:true,cancelable:true,pointerType:'mouse',clientX:x,clientY:y,button:0
      }));
      target.dispatchEvent(new MouseEvent('mousedown',{
        bubbles:true,cancelable:true,view:window,clientX:x,clientY:y,button:0
      }));
      target.dispatchEvent(new PointerEvent('pointerup',{
        bubbles:true,cancelable:true,pointerType:'mouse',clientX:x,clientY:y,button:0
      }));
      target.dispatchEvent(new MouseEvent('mouseup',{
        bubbles:true,cancelable:true,view:window,clientX:x,clientY:y,button:0
      }));
    }catch(_){}
    target.click();
    return true;
  }

  async function chooseSelect(el, wanted, type, scope=document, labels=[]) {
    if (!el || !wanted) return false;
    if(controlMatchesChoice(el,wanted,type)) return true;
    if (el.tagName === 'SELECT') {
      const opt=[...el.options].find(o=>optionMatches(o.text,o.value,wanted,type));
      if(!opt) return false;
      if(!setNativeValue(el,opt.value)) return false;
      return controlMatchesChoice(el,wanted,type);
    }
    if(!click(el)) return false;
    const option=await waitFor(()=>findDropdownOption(wanted,type,el),3000);
    if(!option) return false;
    if(!clickDropdownOption(option)) return false;
    const confirmed=await waitFor(()=>{
      const activeScope=findPassengerDialog()||scope;
      const current=(labels.length && findLabeledControl(activeScope,labels,wanted,type)) ||
        (el.isConnected?el:null);
      if(controlMatchesChoice(current,wanted,type)) return true;
      const selectedOption=findDropdownOption(wanted,type,current);
      return Boolean(selectedOption&&(
        selectedOption.getAttribute('aria-selected')==='true' ||
        selectedOption.getAttribute('aria-checked')==='true' ||
        selectedOption.matches(':checked,.active,.selected') ||
        /(?:^|\s)(?:active|selected)(?:\s|$)/i.test(typeof selectedOption.className==='string'?selectedOption.className:'')
      ));
    },2000);
    return Boolean(confirmed);
  }

  function findChoice(scope, wanted, type) {
    const radios=candidates(scope,'input[type="radio"],[role="radio"],mat-radio-button,label');
    const expected=choiceValue(wanted,type);
    return radios.find(el=>Boolean(expected) && choiceValue(choiceText(el),type)===expected);
  }

  async function selectChoice(scope, labels, wanted, type) {
    for(let attempt=0;attempt<3;attempt++){
      const activeScope=findPassengerDialog()||scope;
      const choice=findChoice(activeScope,wanted,type);
      if(choice){
        if(isSelected(choice)) return true;
        if(click(choice) && await waitFor(()=>{
          const refreshedScope=findPassengerDialog()||scope;
          const refreshedChoice=findChoice(refreshedScope,wanted,type);
          return Boolean(refreshedChoice&&isSelected(refreshedChoice));
        },1000)) return true;
      }

      const currentScope=findPassengerDialog()||scope;
      const control=findLabeledControl(currentScope,labels,wanted,type);
      if(control&&(controlMatchesChoice(control,wanted,type)||
        await chooseSelect(control,wanted,type,currentScope,labels))) return true;
      await sleep(250);
    }
    return false;
  }

  async function fillPassenger(profile, scope) {
    const done=[];
    const issues=[];
    const activeScope=()=>findPassengerDialog()||scope;
    const name=field(activeScope(),['passenger name','passengername','full name','name'],0);

    if(name && setNativeValue(name,profile.name)) done.push('name');
    await sleep(150);
    const age=field(activeScope(),['age'],1);
    if(age && setNativeValue(age,profile.age)) done.push('age');
    await sleep(150);

    if(await selectChoice(activeScope(),['gender','sex'],profile.gender,'gender')){
      done.push('gender');
    } else {
      const genderField=findLabeledControl(activeScope(),['gender','sex'],profile.gender,'gender');
      issues.push(genderField?'Gender dropdown option could not be selected.':'Gender dropdown trigger was not found.');
    }

    await sleep(150);
    if(await selectChoice(activeScope(),['preferences','preference','berth preference','berth'],
      profile.berth||'No Preference','berth')){
      done.push('berth');
    } else {
      const berthField=findLabeledControl(activeScope(),['preferences','preference','berth preference','berth'],
        profile.berth||'No Preference','berth');
      issues.push(berthField
        ? `Berth preference "${profile.berth||'No Preference'}" could not be selected.`
        : 'Berth preference dropdown trigger was not found.');
    }

    const nationality=field(activeScope(),['nationality','country']);
    if(nationality){
      if(nationality.tagName==='SELECT') { if(await chooseSelect(nationality,profile.nationality||'India','nationality')) done.push('nationality'); }
      else if(setNativeValue(nationality,profile.nationality||'India')) done.push('nationality');
    }
    return {done,issues};
  }

  function findAdd(scope){
    const buttons=candidates(scope,'button,a,[role="button"],input[type="button"],input[type="submit"],[data-testid]');
    const add=buttons.map(el=>{
      const label=norm([
        el.innerText,el.value,el.getAttribute('aria-label'),el.getAttribute('title'),
        el.getAttribute('data-testid')
      ].filter(Boolean).join(' '));
      const target=el.closest('button,a,[role="button"],input[type="button"],input[type="submit"]')||el;
      return {el:target,label};
    }).filter(({el,label})=>
      visible(el) &&
      /^(?:\+\s*)?add(?:\s+passenger)?$/.test(label) &&
      !/cancel|close|remove|delete/.test(label)
    );
    add.sort((a,b)=>(a.label.length-b.label.length) || (a.el.tagName==='BUTTON'?-1:1));
    return add[0]?.el || candidates(scope,'button[type="submit"],input[type="submit"]')[0] || null;
  }

  function validationMessage(scope){
    const message=[...scope.querySelectorAll('[role="alert"],[aria-live="assertive"],.error,.invalid-feedback,mat-error')]
      .filter(visible)
      .map(el=>norm(el.innerText||el.textContent))
      .find(Boolean);
    return message||'';
  }

  function findPassengerSummary(name, excludedScope){
    const wanted=norm(name);
    if(!wanted) return null;
    return [...document.querySelectorAll(
      'tr,li,article,div,span,p,[class*="passenger" i],[class*="traveller" i],[class*="travel" i]'
    )].filter(el=>{
      if(!visible(el)||excludedScope?.contains(el)) return false;
      const text=norm(el.innerText||el.textContent);
      return (text===wanted||text.startsWith(`${wanted} `)||text.includes(` ${wanted} `))&&text.length<300;
    }).sort((a,b)=>(a.innerText||a.textContent||'').length-(b.innerText||b.textContent||'').length)[0]||null;
  }

  async function addPassenger(scope,name){
    const nameValue=name;
    const activeScope=()=>findPassengerDialog()||scope;
    const btn=await waitFor(()=>findAdd(activeScope()),3000);
    if(!btn || !click(btn)) return {ok:false,message:'Passenger details are filled, but the Add button could not be clicked.'};
    const result=await waitFor(()=>{
      const currentScope=activeScope();
      const validation=validationMessage(currentScope);
      if(validation) return {ok:false,message:`IRCTC did not add the passenger: ${validation}`};
      if(findPassengerSummary(nameValue,currentScope)) return {ok:true};
      return null;
    },8000);
    if(result) return result;
    return {ok:false,message:`Clicked Add, but IRCTC did not show ${nameValue} in the passenger list. The passenger may not have been added; check the form and do not continue until all passengers are listed.`};
  }

  function isSelected(el){
    if(el.matches(':checked,[aria-checked="true"],[aria-selected="true"],.active,.selected') ||
      /(?:^|\s)(?:active|selected)(?:\s|$)/i.test(typeof el.className==='string'?el.className:'')) return true;
    const labelControl=el.matches('label')?el.control:null;
    if(labelControl?.checked) return true;
    const container=el.closest('label,[role="radio"],mat-radio-button,.payment-option');
    return Boolean(container?.querySelector('input[type="radio"]:checked,[aria-checked="true"],[aria-selected="true"]'));
  }

  function findBhimUpiCard(scope=document){
    const phrase=/pay through bhim\s*\/\s*upi/;
    const cards=[...scope.querySelectorAll(
      '.payment-option,[role="radio"],label,button,[role="button"],article,section,li,div'
    )].filter(el=>{
      if(!visible(el)||!phrase.test(norm(el.innerText||el.textContent))) return false;
      const rect=el.getBoundingClientRect();
      return rect.width>=300&&rect.height>=40&&rect.height<=220;
    }).map(el=>{
      const rect=el.getBoundingClientRect();
      return {el,area:rect.width*rect.height,height:rect.height};
    }).sort((a,b)=>a.area-b.area||a.height-b.height);
    if(cards.length) return cards[0].el;

    const textNode=[...scope.querySelectorAll('span,strong,p')]
      .find(el=>visible(el)&&phrase.test(norm(el.innerText||el.textContent)));
    if(!textNode) return null;
    let card=textNode;
    for(let depth=0;depth<5&&card.parentElement&&card.parentElement!==scope;depth++){
      card=card.parentElement;
      const rect=card.getBoundingClientRect();
      if(rect.width>=300&&rect.height>=40&&rect.height<=220) return card;
    }
    return card;
  }

  function isBhimUpiSelected(card){
    if(!card) return false;
    if(card.matches('[aria-checked="true"],[aria-selected="true"],input:checked') ||
      /(?:^|\s)(?:active|selected|checked)(?:\s|$)/i.test(typeof card.className==='string'?card.className:'')) return true;
    if(card.querySelector('input[type="radio"]:checked,[role="radio"][aria-checked="true"],[aria-checked="true"],[aria-selected="true"]')) return true;
    let parent=card.parentElement;
    for(let depth=0;depth<3&&parent;depth++,parent=parent.parentElement){
      if(/(?:^|\s)(?:active|selected|checked)(?:\s|$)/i.test(typeof parent.className==='string'?parent.className:'')) return true;
      if(parent.matches('[aria-checked="true"],[aria-selected="true"]')) return true;
    }
    const radio=bhimUpiRadio(card);
    return Boolean(radio?.checked||radio?.getAttribute('aria-checked')==='true');
  }

  function bhimUpiRadio(card){
    if(!card) return null;
    if(card.matches('input[type="radio"],[role="radio"]')) return card;
    const cardRect=card.getBoundingClientRect();
    const radios=[...document.querySelectorAll('input[type="radio"],[role="radio"]')];
    const related=radios.map(radio=>{
      const label=radio.labels?.[0]||radio.closest('label');
      const target=label||radio;
      const rect=target.getBoundingClientRect();
      const contained=card.contains(radio)||card.contains(target);
      const overlaps=rect.width>0&&rect.height>0&&
        rect.right>=cardRect.left&&rect.left<=cardRect.right&&
        rect.bottom>=cardRect.top&&rect.top<=cardRect.bottom;
      const distance=Math.abs((rect.top+rect.height/2)-(cardRect.top+cardRect.height/2))+
        Math.abs((rect.left+rect.width/2)-cardRect.right);
      return {radio,contained,overlaps,distance};
    }).filter(item=>item.contained||item.overlaps)
      .sort((a,b)=>Number(b.contained)-Number(a.contained)||a.distance-b.distance);
    if(related.length) return related[0].radio;

    let parent=card.parentElement;
    for(let depth=0;depth<3&&parent;depth++,parent=parent.parentElement){
      const group=[...parent.querySelectorAll('input[type="radio"],[role="radio"]')];
      if(group.length===1) return group[0];
      if(group.length>1) break;
    }
    return null;
  }

  function clickBhimUpiCard(card){
    const rect=card.getBoundingClientRect();
    const x=Math.max(rect.left+8,rect.right-Math.min(32,rect.width/4));
    const y=rect.top+rect.height/2;
    const hit=document.elementFromPoint(x,y);
    const target=hit&&(card.contains(hit)||hit===card)?hit:card;
    target.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,pointerType:'mouse',clientX:x,clientY:y,button:0}));
    target.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true,view:window,clientX:x,clientY:y,button:0}));
    target.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,cancelable:true,pointerType:'mouse',clientX:x,clientY:y,button:0}));
    target.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,cancelable:true,view:window,clientX:x,clientY:y,button:0}));
    target.click();
    return true;
  }

  async function selectUPI(){
    const card=findBhimUpiCard();
    if(!card) return false;
    if(isBhimUpiSelected(card)) return true;

    const radio=bhimUpiRadio(card);
    const label=radio?.labels?.[0] || radio?.closest('label') || null;
    if(radio&&!radio.disabled){
      radio.click();
      if(await waitFor(()=>radio.checked||isBhimUpiSelected(card),1000)) return true;
    }
    if(label&&visible(label)){
      if(!click(label)) label.click();
      if(await waitFor(()=>radio?.checked||isBhimUpiSelected(card),1000)) return true;
    }
    clickBhimUpiCard(card);

    return Boolean(await waitFor(()=>{
      const current=findBhimUpiCard();
      return isBhimUpiSelected(current);
    },5000));
  }

  function fareCalculationInProgress(){
    const busyElements=[...document.querySelectorAll(
      '[aria-busy="true"],[role="progressbar"],mat-progress-spinner,.mat-mdc-progress-spinner,.spinner,.loading,.loader,[class*="spinner" i]'
    )];
    if(busyElements.some(rendered)) return true;

    return [...document.querySelectorAll('[role="status"],[role="alert"],[aria-live]')]
      .filter(rendered)
      .some(el=>/calculating fare|fare calculation|loading fare|please wait/i.test(norm(el.innerText||el.textContent)));
  }

  async function calculateFare(){
    const btn=await waitFor(()=>findButton(['calculate fare','calculatefare','fare calculate']),8000);
    if(!btn) return {ok:false,reason:'missing'};
    if(!click(btn)) return {ok:false,reason:'click'};

    const startedAt=Date.now();
    let lastMutationAt=startedAt;
    const observer=new MutationObserver(()=>{lastMutationAt=Date.now();});
    observer.observe(document.body,{subtree:true,childList:true,characterData:true});

    try{
      const continueButton=await waitFor(()=>{
        if(Date.now()-startedAt<1000 || Date.now()-lastMutationAt<700 || fareCalculationInProgress()) return null;
        return findContinuePaymentButton();
      },20000);
      return continueButton?{ok:true,button:continueButton}:{ok:false,reason:'timeout'};
    }finally{
      observer.disconnect();
    }
  }

  function findContinuePaymentButton(){
    const buttons=candidates(document,'button,a,[role="button"],input[type="button"],input[type="submit"]');
    const labelOf=el=>{
      const label=norm([el.innerText,el.value,el.getAttribute('aria-label'),el.getAttribute('title')].filter(Boolean).join(' '));
      return label;
    };
    return buttons.find(el=>/^(continue\s+to\s+payment|proceed\s+to\s+payment)$/.test(labelOf(el)))||
      buttons.find(el=>labelOf(el)==='continue')||null;
  }

  async function addOnePassenger(profile,index){
    if(findPassengerDialog()) return {ok:false,message:`Passenger ${index+1} (${profile.name}): the previous passenger form is still open.`};
    const newBtn=await waitFor(findNewPassenger,4000);
    if(!newBtn) return {ok:false,message:`Passenger ${index+1} (${profile.name}): New Passenger button not found.`};
    if(!click(newBtn)) return {ok:false,message:`Passenger ${index+1} (${profile.name}): New Passenger button could not be clicked.`};
    const dialog=await waitFor(findPassengerDialog,5000);
    if(!dialog) return {ok:false,message:`Passenger ${index+1} (${profile.name}): passenger form did not open.`};

    const result=await fillPassenger(profile,dialog);
    const filled=result.done;
    const missing=['name','age','gender','berth'].filter(x=>!filled.includes(x));
    if(missing.length) {
      const details=result.issues.length?` ${result.issues.join(' ')}`:'';
      return {ok:false,message:`Passenger ${index+1} (${profile.name}): could not fill ${missing.join(', ')}.${details} No passenger was added.`};
    }

    const added=await addPassenger(dialog,profile.name);
    if(!added.ok) return {ok:false,message:`Passenger ${index+1} (${profile.name}): ${added.message}`};
    return {ok:true,filled};
  }

  async function dismissPassengerDialog(){
    const dialog=findPassengerDialog();
    if(!dialog) return true;
    const cancel=candidates(dialog,'button,a,[role="button"]').find(el=>
      /^(cancel|close|×|x)$/.test(norm([
        el.innerText,el.textContent,el.getAttribute('aria-label'),el.getAttribute('title')
      ].filter(Boolean).join(' ')))
    );
    if(cancel) click(cancel);
    return Boolean(await waitFor(()=>!findPassengerDialog(),2000));
  }

  async function run(input){
    const profiles=Array.isArray(input.profiles)?input.profiles:
      (input.profile?[input.profile]:[]);
    if(!profiles.length) return {ok:false,message:'No saved passengers were provided. Add passenger profiles in the extension first.'};

    const filled=[];
    for(let index=0;index<profiles.length;index++){
      const closed=await dismissPassengerDialog();
      if(!closed) return {ok:false,message:`Passenger ${index+1} (${profiles[index].name}): close the previous passenger form before adding the next passenger.`};

      const result=await addOnePassenger(profiles[index],index);
      if(!result.ok) return result;
      filled.push(...result.filled);

      if(index<profiles.length-1){
        const closedAfterAdd=await waitFor(()=>!findPassengerDialog(),2000)||await dismissPassengerDialog();
        if(!closedAfterAdd){
          return {ok:false,message:`Passenger ${index+1} (${profiles[index].name}) was added, but the passenger form did not close before adding the next passenger.`};
        }
      }
    }

    const dialogClosed=await dismissPassengerDialog();
    if(!dialogClosed) return {ok:false,message:'Passengers were added, but the passenger form could not be closed to continue booking.'};

    const paymentReady=await waitFor(findBhimUpiCard,10000);
    if(!paymentReady) return {ok:false,message:'Passenger was added, but the Pay through BHIM/UPI payment option did not appear.'};
    const upi=await selectUPI();
    if(!upi) return {ok:false,message:'Passenger added, but Pay through BHIM/UPI could not be selected.'};

    const fare=await calculateFare();
    if(!fare.ok){
      if(fare.reason==='missing') return {ok:false,message:'Pay through BHIM/UPI was selected, but Calculate Fare was not found.'};
      if(fare.reason==='click') return {ok:false,message:'Pay through BHIM/UPI was selected, but Calculate Fare could not be clicked.'};
      return {ok:false,message:'Fare calculation did not finish or the Continue to Payment button did not become ready. Check the fare and try again.'};
    }
    await sleep(1000);
    const continueButton=await waitFor(findContinuePaymentButton,3000);
    if(!continueButton) return {ok:false,message:'Fare was calculated, but the Continue to Payment button was no longer available after waiting.'};
    if(!click(continueButton)) return {ok:false,message:'Fare was calculated, but Continue to Payment could not be clicked.'};

    const names=profiles.map(profile=>profile.name).filter(Boolean).join(', ');
    return {ok:true,message:`Added ${profiles.length} passenger${profiles.length===1?'':'s'} (${names}), selected Pay through BHIM/UPI, calculated fare, and continued to payment.`};
  }

  chrome.runtime.onMessage.addListener((message,_sender,sendResponse)=>{
    if(message?.type!=='IRCTC_FILL') return;
    run(message||{}).then(sendResponse).catch(err=>{
      console.error('[IRCTC Autofill]',err);
      sendResponse({ok:false,message:'Autofill error: '+(err?.message||'unknown error')});
    });
    return true;
  });
})();
