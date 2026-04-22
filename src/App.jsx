import React, { useState, useEffect } from 'react';

const markdownContent = `# Dokumentace Solárního Systému (ESP32)

Tento dokument obsahuje technickou specifikaci, logiku řízení a schémata pro projekt **Teplomer Backend (ESP32_solary)**.

## 🛠 Technický přehled
- **Hardware:** ESP32
- **Komunikace:** Modbus TCP (čtení), MQTT & ThingSpeak (odesílání), ArduinoOTA (aktualizace).
- **Měření:** 7 kanálů teploty (kolektor, bojler nový - 3x, bojler starý - 2x, pec).

## 🚀 Provozní režimy (Mody)
Na základě logiky firmwaru jsou definovány tyto reálné provozní stavy:

### 1. Režim Diferenčního Ohřevu (Automatika)
- **Podmínka sepnutí:** \`T_solarni\` - \`T_nadrz\` > **25 °C**.
- **Podmínka vypnutí:** Rozdíl klesne pod **15 °C**.
- **Cíl:** Maximalizace zisku energie při zachování životnosti čerpadla.

### 2. Havarijní Režim (Ochrana proti přehřátí)
- **Podmínka:** \`T_solarni\` > **95 °C**.
- **Akce:** Čerpadlo se sepne na 100 %, aby došlo k ochlazení kolektoru do nádrží.

### 3. Manuální / MQTT Režim (Vzdálený zásah)
- **Zdroj:** Zpráva v MQTT tématu \`pump\`.
- **Využití:** Servisní zásahy, testování systému nebo vynucené nahřátí.

### 4. Režim Sledování Tarifu (Noční proud)
- **Detekce:** Vstup \`NOCNI\`.
- **Funkce:** Systém reportuje stav nízkého tarifu, což umožňuje budoucí rozšíření o logiku pro elektrický dohřev v době levné elektřiny.

## 📋 Zapojení čidel
| Čidlo | Umístění | Účel | 
| ----- | ----- | ----- | 
| **T1** | Solární kolektor | Hlavní zdroj tepla | 
| **T2-T4** | Nový bojler | Stratifikace teploty v hlavní nádrži | 
| **T5-T6** | Starý bojler | Monitoring sekundární nádrže | 
| **Tp1** | Pec | Monitoring externího spalovacího zdroje | 

*Dokumentace vygenerována pro: Vojtěch Lisztwan*`;

export default function App() {
  const [copyStatus, setCopyStatus] = useState('');
  
  const defaultInitTemps = {
    T1: 25.0, T2: 30.0, T3: 25.0, T4: 20.0, T5: 22.0, T6: 20.0, Tp1: 20.0
  };
  const [initTemps, setInitTemps] = useState(defaultInitTemps);
  const [simSpeed, setSimSpeed] = useState(1);

  // Komplexní stav simulace (odpovídá proměnným v ESP32)
  const [sim, setSim] = useState({
    autoswitch: true, // Odpovídá bool autoswitch (přepínání ventilu)
    pumpOverride: false, // Odpovídá pumpAlways v ESP32 přes MQTT
    pump: false, // Odpovídá fyzickému stavu relé (bcerpadlo nebo pumpAlways)
    valve: 'top', // 'top' odpovídá spir=true, 'bottom' odpovídá spir=false
    furnacePump: false, // Externí oběh pece
    solarPower: 60, // 0-100%
    furnacePower: 0, // 0-100%
    temps: { ...defaultInitTemps }
  });

  const handleReset = () => {
    setSim(s => ({
      ...s,
      temps: { ...initTemps },
      pump: false,
      pumpOverride: false,
      furnacePump: false
    }));
  };

  const handleCopy = () => {
    const textArea = document.createElement('textarea');
    textArea.value = markdownContent;
    document.body.appendChild(textArea);
    textArea.select();
    try {
      document.execCommand('copy');
      setCopyStatus('Úspěšně zkopírováno!');
      setTimeout(() => setCopyStatus(''), 3000);
    } catch (err) {
      setCopyStatus('Chyba při kopírování.');
      setTimeout(() => setCopyStatus(''), 3000);
    }
    document.body.removeChild(textArea);
  };

  // HLAVNÍ SIMULAČNÍ SMYČKA (Fyzika + ESP32 Logika)
  useEffect(() => {
    const interval = setInterval(() => {
      setSim(prev => {
        // Hluboká kopie stavu
        const s = { ...prev, temps: { ...prev.temps } };
        const t = s.temps;

        // 1. ZDROJE TEPLA (Ohřev od slunce a pece)
        t.T1 += (s.solarPower / 100) * 3.0; // Slunce hřeje kolektor
        t.Tp1 += (s.furnacePower / 100) * 4.0; // Pec se roztápí

        // 2. PŘIROZENÉ CHLADNUTÍ (Ztráty do okolí 20°C)
        const cool = (temp, factor) => Math.max(20, temp - (temp - 20) * factor);
        t.T1 = cool(t.T1, 0.02); 
        t.T2 = cool(t.T2, 0.002);
        t.T3 = cool(t.T3, 0.002);
        t.T4 = cool(t.T4, 0.002);
        t.T5 = cool(t.T5, 0.002);
        t.T6 = cool(t.T6, 0.002);
        t.Tp1 = cool(t.Tp1, 0.03); 

        // 3. LOGIKA ESP32
        // A) Logika přepínání ventilu (Mění se jen, pokud je zapnutý autoswitch)
        if (s.autoswitch) {
          if (t.T2 > 45) s.valve = 'bottom';
          if (t.T2 < 45) s.valve = 'top';
        }

        // B) Referenční teplota pro sepnutí podle ESP32 (temp[2]=T3 pro horní, temp[3]=T4 pro dolní)
        const pomTep = s.valve === 'top' ? t.T3 : t.T4;

        // C) Logika solárního čerpadla - diferenční ohřev BĚŽÍ VŽDY nezávisle na autoswitch!
        if (t.T1 > 95) {
          s.pump = true; // Havarijní režim (Přehřátí)
        } else if (t.T1 - pomTep > 25) {
          s.pump = true; // Diferenční sepnutí
        } else if (t.T1 - pomTep < 15) {
          s.pump = false; // Diferenční vypnutí
        }

        // D) MQTT override čerpadla (pumpAlways)
        if (s.pumpOverride) {
          s.pump = true;
        }

        // E) Logika pece (zjednodušeně: pokud je pec horká, spustí se oběh do bojlerů)
        s.furnacePump = t.Tp1 > 60;

        // 4. PŘEDÁVÁNÍ TEPLA (Cirkulace vody)
        // A) Solární okruh
        if (s.pump) {
          if (t.T1 > pomTep) {
            const transfer = (t.T1 - pomTep) * 0.15; // Rychlost předávání tepla
            t.T1 -= transfer; // Kolektor se ochladí
            if (s.valve === 'top') {
              t.T2 += transfer * 0.6; // Horní spirála ohřívá T2 a T3
              t.T3 += transfer * 0.4;
            } else {
              t.T4 += transfer * 0.8; // Dolní spirála ohřívá hlavně T4 a T3
              t.T3 += transfer * 0.2;
            }
          }
        }

        // B) Okruh pece
        if (s.furnacePump) {
          if (t.Tp1 > t.T4 || t.Tp1 > t.T6) {
            const transfer = Math.max(0, (t.Tp1 - Math.min(t.T4, t.T6)) * 0.08);
            t.Tp1 -= transfer;
            t.T4 += transfer * 0.4; 
            t.T6 += transfer * 0.4; 
          }
        }

        // 5. PŘIROZENÁ KONVEKCE (Teplo stoupá nahoru)
        const convectionRate = 0.15; 
        if (t.T4 > t.T3) {
          const trans = (t.T4 - t.T3) * convectionRate;
          t.T4 -= trans; t.T3 += trans;
        }
        if (t.T3 > t.T2) {
          const trans = (t.T3 - t.T2) * convectionRate;
          t.T3 -= trans; t.T2 += trans;
        }
        if (t.T6 > t.T5) {
          const trans = (t.T6 - t.T5) * convectionRate;
          t.T6 -= trans; t.T5 += trans;
        }

        return s;
      });
    }, 500 / simSpeed); 
    return () => clearInterval(interval);
  }, [simSpeed]);

  const setSolarPower = (e) => setSim(s => ({ ...s, solarPower: Number(e.target.value) }));
  const setFurnacePower = (e) => setSim(s => ({ ...s, furnacePower: Number(e.target.value) }));
  const setAutoswitch = (val) => setSim(s => ({ ...s, autoswitch: val }));
  const togglePumpOverride = () => setSim(s => ({ ...s, pumpOverride: !s.pumpOverride }));

  const getTempColor = (temp) => {
    if (temp < 30) return "#3b82f6"; // Modrá
    if (temp < 50) return "#eab308"; // Žlutá
    if (temp < 80) return "#f97316"; // Oranžová
    return "#ef4444"; // Červená
  };

  // Výpočty pro ESP32 panel (živá vizualizace)
  const currentPomTep = sim.valve === 'top' ? sim.temps.T3 : sim.temps.T4;
  const currentRozdil = sim.temps.T1 - currentPomTep;
  const barProgress = Math.min(100, Math.max(0, (currentRozdil / 30) * 100));

  return (
    <div className="min-h-screen bg-slate-100 p-4 md:p-8 font-sans text-slate-800 flex flex-col xl:flex-row gap-8">
      
      <style>{`
        @keyframes dash {
          to { stroke-dashoffset: -20; }
        }
        .pipe-flow {
          stroke-dasharray: 10;
          animation: dash 1s linear infinite;
        }
        .pipe-flow-fast {
          stroke-dasharray: 10;
          animation: dash 0.5s linear infinite;
        }
        .temp-label {
          font-family: monospace;
          font-weight: bold;
          font-size: 14px;
        }
      `}</style>

      {/* LEVÝ PANEL: Dokumentace */}
      <div className="w-full xl:w-1/3 bg-white rounded-xl shadow-lg p-6 flex flex-col h-[850px]">
        <div className="flex justify-between items-center mb-6 border-b pb-4">
          <h2 className="text-2xl font-bold text-slate-800">Dokumentace</h2>
          <button 
            onClick={handleCopy}
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition-colors font-medium text-sm flex items-center gap-2"
          >
            <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
            Kopírovat .md
          </button>
        </div>

        {copyStatus && (
          <div className="bg-green-100 text-green-800 px-4 py-2 rounded mb-4 text-sm font-bold text-center border border-green-200">
            {copyStatus}
          </div>
        )}

        <div className="overflow-y-auto flex-1 pr-2 prose prose-sm prose-slate">
          <h3 className="text-lg font-bold mt-0">🛠 Technický přehled</h3>
          <ul className="list-disc pl-5 mb-4 space-y-1">
            <li><strong>Hardware:</strong> ESP32</li>
            <li><strong>Komunikace:</strong> Modbus TCP, MQTT & ThingSpeak, ArduinoOTA</li>
            <li><strong>Měření:</strong> 7 kanálů teploty</li>
          </ul>

          <h3 className="text-lg font-bold">🚀 Provozní režimy (Mody)</h3>
          
          <h4 className="font-semibold text-blue-700">1. Diferenční Ohřev</h4>
          <p className="mb-2 text-sm">Sepnutí při rozdílu &gt; 25°C, vypnutí při &lt; 15°C.</p>

          <h4 className="font-semibold text-red-600">2. Havarijní Režim</h4>
          <p className="mb-2 text-sm">T_solarni &gt; 95°C. Čerpadlo jede na 100%.</p>

          <h4 className="font-semibold text-purple-600">3. Manuální (MQTT)</h4>
          <p className="mb-2 text-sm">Vzdálený zásah přes téma <code>pump</code>.</p>

          <h4 className="font-semibold text-yellow-600">4. Noční proud</h4>
          <p className="mb-4 text-sm">Detekce přes vstup <code>NOCNI</code>.</p>

          <h3 className="text-lg font-bold">📋 Čidla</h3>
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b-2">
                <th className="py-1">Čidlo</th>
                <th>Umístění</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b"><td className="py-1 font-bold">T1</td><td>Solární kolektor</td></tr>
              <tr className="border-b"><td className="py-1 font-bold">T2-T4</td><td>Nový bojler (Stratifikace)</td></tr>
              <tr className="border-b"><td className="py-1 font-bold">T5-T6</td><td>Starý bojler</td></tr>
              <tr><td className="py-1 font-bold">Tp1</td><td>Pec</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* PRAVÝ PANEL: Interaktivní Animace */}
      <div className="w-full xl:w-2/3 bg-white rounded-xl shadow-lg p-6 flex flex-col">
        <div className="flex justify-between items-center mb-4 border-b pb-4">
          <h2 className="text-2xl font-bold text-slate-800">Živá vizualizace a simulace</h2>
          
          {/* Přepínač rychlosti a autoswitch */}
          <div className="flex gap-4">
            <select 
              value={simSpeed} 
              onChange={e => setSimSpeed(Number(e.target.value))} 
              className="bg-slate-100 border border-slate-300 rounded-lg px-3 py-1.5 text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value={0.5}>0.5x Rychlost</option>
              <option value={1}>1x Rychlost</option>
              <option value={2}>2x Rychlost</option>
              <option value={5}>5x Rychlost</option>
              <option value={10}>10x Rychlost</option>
            </select>

            <div className="flex bg-slate-200 rounded-lg p-1">
              <button 
                onClick={() => setAutoswitch(true)}
                className={`px-4 py-1.5 rounded-md font-bold text-sm transition-all ${sim.autoswitch ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-300'}`}
              >
                AUTOSWITCH: ZAP
              </button>
              <button 
                onClick={() => setAutoswitch(false)}
                className={`px-4 py-1.5 rounded-md font-bold text-sm transition-all ${!sim.autoswitch ? 'bg-amber-500 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-300'}`}
              >
                AUTOSWITCH: VYP
              </button>
            </div>
          </div>
        </div>

        {/* Nastavení počátečních teplot */}
        <div className="bg-slate-100 p-3 rounded-lg mb-4 text-sm border border-slate-200 shadow-sm">
          <div className="font-bold mb-2 flex justify-between items-center text-slate-700">
            <span>Výchozí teploty pro simulaci (°C):</span>
            <button onClick={handleReset} className="bg-red-500 text-white px-4 py-1.5 rounded-md text-xs font-bold hover:bg-red-600 shadow-sm transition-all">
              RESTARTOVAT SIMULACI
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {Object.keys(initTemps).map(k => (
              <label key={k} className="flex items-center gap-1 bg-white px-2 py-1 rounded shadow-sm border border-slate-200">
                <span className="font-bold text-slate-600">{k}:</span>
                <input
                  type="number"
                  className="w-14 bg-transparent outline-none text-right font-mono"
                  value={initTemps[k]}
                  onChange={e => setInitTemps({...initTemps, [k]: Number(e.target.value)})}
                />
              </label>
            ))}
          </div>
        </div>
        
        {/* Simulační vstupy (Posuvníky) */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-4 p-4 bg-slate-800 rounded-lg text-white">
          <div>
            <div className="flex justify-between mb-1">
              <label className="text-sm font-bold text-amber-400">☀ Výkon solárních kolektorů</label>
              <span className="text-sm font-mono">{sim.solarPower}%</span>
            </div>
            <input type="range" min="0" max="100" value={sim.solarPower} onChange={setSolarPower} className="w-full accent-amber-500" />
          </div>
          <div>
            <div className="flex justify-between mb-1">
              <label className="text-sm font-bold text-orange-400">🔥 Intenzita topení v peci</label>
              <span className="text-sm font-mono">{sim.furnacePower}%</span>
            </div>
            <input type="range" min="0" max="100" value={sim.furnacePower} onChange={setFurnacePower} className="w-full accent-orange-500" />
          </div>
        </div>

        {/* ESP32 Logika - Dynamický výpočet */}
        <div className="bg-slate-900 text-white p-4 rounded-lg mb-4 shadow-md border border-slate-700 relative overflow-hidden">
          <div className="absolute top-0 right-0 p-2 opacity-10">
            <svg width="64" height="64" fill="none" stroke="currentColor" strokeWidth="1" viewBox="0 0 24 24"><path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0H5a2 2 0 0 1-2-2v-4m6 6h10a2 2 0 0 0 2-2v-4"></path></svg>
          </div>
          <h3 className="font-bold text-xs text-blue-400 mb-3 uppercase tracking-wider flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></span>
            ESP32 Živé proměnné (Neustále sledují teplotu)
          </h3>
          
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm relative z-10">
            <div className="bg-slate-800 p-2 rounded border border-slate-700">
              <span className="block text-slate-400 text-[10px] uppercase mb-1">Referenční senzor (pomTep)</span>
              <span className="font-mono text-lg font-bold">{sim.valve === 'top' ? 'T3 (střed)' : 'T4 (spodek)'}: {currentPomTep.toFixed(1)}°</span>
            </div>
            <div className="bg-slate-800 p-2 rounded border border-slate-700">
              <span className="block text-slate-400 text-[10px] uppercase mb-1">Aktuální rozdíl (T1 - pomTep)</span>
              <span className={`font-mono text-lg font-bold ${currentRozdil > 25 ? 'text-red-400' : currentRozdil > 15 ? 'text-amber-400' : 'text-blue-400'}`}>
                {currentRozdil > 0 ? '+' : ''}{currentRozdil.toFixed(1)}°
              </span>
            </div>
            <div className="bg-slate-800 p-2 rounded border border-slate-700">
              <span className="block text-slate-400 text-[10px] uppercase mb-1">Hranice sepnutí (T1 &gt;)</span>
              <span className="font-mono text-lg font-bold text-red-400">{(currentPomTep + 25).toFixed(1)}°</span>
            </div>
            <div className="bg-slate-800 p-2 rounded border border-slate-700">
              <span className="block text-slate-400 text-[10px] uppercase mb-1">Hranice vypnutí (T1 &lt;)</span>
              <span className="font-mono text-lg font-bold text-blue-400">{(currentPomTep + 15).toFixed(1)}°</span>
            </div>
          </div>
          
          <div className="mt-4 flex items-center gap-3 relative z-10">
            <span className="text-xs font-bold text-slate-400 min-w-[40px]">T1 - ref:</span>
            <div className="flex-1 bg-slate-800 h-3 rounded-full overflow-hidden relative border border-slate-700">
              {/* Značky sepnutí a vypnutí na progress baru (15 a 25 stupňů z max 30) */}
              <div className="absolute top-0 bottom-0 left-[50%] w-[2px] bg-blue-400 z-20"></div>
              <div className="absolute top-0 bottom-0 left-[83.3%] w-[2px] bg-red-400 z-20"></div>
              
              <div 
                className={`h-full transition-all duration-300 ${currentRozdil > 25 ? 'bg-red-500' : currentRozdil > 15 ? 'bg-amber-500' : 'bg-blue-500'}`}
                style={{ width: barProgress + '%' }}
              ></div>
            </div>
            <span className="text-xs text-slate-400 min-w-[30px]">30°C</span>
          </div>
        </div>

        {/* Ovládací panel ESP32 */}
        <div className="flex flex-wrap gap-4 mb-6 p-4 rounded-lg border bg-slate-50">
          
          <div className="flex flex-col flex-1">
            <span className="text-xs font-bold text-slate-500 uppercase mb-1 flex items-center gap-2">
              Solární čerpadlo (C)
              <span className={`w-2 h-2 rounded-full ${sim.pump ? 'bg-red-500' : 'bg-slate-300'}`}></span>
            </span>
            <button 
              onClick={togglePumpOverride}
              className={`px-4 py-2 rounded-lg font-bold transition-all border-2 ${sim.pumpOverride ? 'bg-red-500 text-white border-red-600 shadow-inner' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'}`}
            >
              {sim.pumpOverride ? 'VYNUCENO (pumpAlways)' : 'VYNUTIT BĚH (Override)'}
            </button>
            <span className="text-[10px] text-slate-400 mt-1 text-center font-bold">
              {sim.pump && !sim.pumpOverride ? "BĚŽÍ NA AUTOMATIKU" : !sim.pump ? "VYPNUTO" : "ZAPNUTO Z MQTT"}
            </span>
          </div>

          <div className="flex flex-col relative flex-1 border-l pl-4">
            <span className="text-xs font-bold text-slate-500 uppercase mb-1">Přepínací ventil (V)</span>
            
            {/* Překrytí, pokud ESP32 řídí spirály automaticky */}
            {sim.autoswitch && (
              <div className="absolute inset-0 top-5 bg-slate-50/50 z-10 flex items-center justify-center cursor-not-allowed rounded" title="Vypněte Autoswitch pro manuální řízení"></div>
            )}
            
            <div className={`flex bg-slate-200 rounded-lg overflow-hidden transition-opacity ${sim.autoswitch ? 'opacity-50' : ''}`}>
              <button 
                onClick={() => !sim.autoswitch && setSim(s => ({ ...s, valve: 'top' }))}
                className={`px-4 py-2 font-bold w-1/2 transition-all ${sim.valve === 'top' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-300'}`}
              >
                HORNÍ
              </button>
              <button 
                onClick={() => !sim.autoswitch && setSim(s => ({ ...s, valve: 'bottom' }))}
                className={`px-4 py-2 font-bold w-1/2 transition-all ${sim.valve === 'bottom' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-300'}`}
              >
                DOLNÍ
              </button>
            </div>
            <span className="text-[10px] text-slate-400 mt-1 text-center font-bold">
              {sim.autoswitch ? "ŘÍZENO AUTOMATIKOU ESP32" : "KLIKNUTÍM PŘEPNĚTE SPIRÁLU"}
            </span>
          </div>

          <div className="flex flex-col flex-1 border-l pl-4">
            <span className="text-xs font-bold text-slate-500 uppercase mb-1 flex items-center gap-2">
              Okruh Pece (P)
              <span className={`w-2 h-2 rounded-full ${sim.furnacePump ? 'bg-orange-500' : 'bg-slate-300'}`}></span>
            </span>
            <button 
              onClick={() => setSim(s => ({ ...s, furnacePump: !s.furnacePump }))}
              className={`px-4 py-2 rounded-lg font-bold transition-all border-2 ${sim.furnacePump ? 'bg-orange-500 text-white border-orange-600 shadow-inner' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'}`}
            >
              {sim.furnacePump ? 'OBĚH PECE BĚŽÍ' : 'ZAPNOUT OBĚH PECE'}
            </button>
          </div>
        </div>

        {/* SVG PLÁTNO */}
        <div className="flex-1 bg-[#f8fafc] border-2 border-slate-200 rounded-xl overflow-hidden relative min-h-[500px]">
          <svg viewBox="0 0 800 600" className="w-full h-full drop-shadow-sm">
            <defs>
              <linearGradient id="fireGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={sim.furnacePower > 0 ? "#ef4444" : "#94a3b8"} />
                <stop offset="100%" stopColor={sim.furnacePower > 0 ? "#f97316" : "#64748b"} />
              </linearGradient>
              <linearGradient id="solarGrad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor={sim.solarPower > 0 ? "#fcd34d" : "#94a3b8"} />
                <stop offset="100%" stopColor={sim.solarPower > 0 ? "#f59e0b" : "#64748b"} />
              </linearGradient>
            </defs>

            {/* ZÁKLADNÍ TRUBKY (Šedé pozadí) */}
            <g stroke="#cbd5e1" strokeWidth="8" fill="none" strokeLinecap="round" strokeLinejoin="round">
              <path d="M 150 100 L 220 100" />
              <path d="M 280 100 L 330 100" />
              <path d="M 350 80 L 350 40 L 400 40 L 400 120 L 450 120" />
              <path d="M 350 120 L 350 250 L 450 250" />
              <path d="M 150 430 L 400 430 L 400 290 L 450 290" />
              <path d="M 150 470 L 620 470 L 620 280 L 650 280" />
            </g>

            {/* AKTIVNÍ TRUBKY (Animované - Solár) */}
            <g stroke="#dc2626" strokeWidth="4" fill="none" strokeLinecap="round" strokeLinejoin="round" className="pipe-flow">
              {sim.pump && (
                <>
                  <path d="M 150 100 L 220 100" />
                  <path d="M 280 100 L 330 100" />
                  {sim.valve === 'top' && (
                    <path d="M 350 80 L 350 40 L 400 40 L 400 120 L 450 120" />
                  )}
                  {sim.valve === 'bottom' && (
                    <path d="M 350 120 L 350 250 L 450 250" />
                  )}
                </>
              )}
            </g>
            
            {/* AKTIVNÍ TRUBKY (Animované - Pec) */}
            <g stroke="#ea580c" strokeWidth="4" fill="none" strokeLinecap="round" strokeLinejoin="round" className="pipe-flow-fast">
              {sim.furnacePump && (
                <>
                  <path d="M 150 430 L 400 430 L 400 290 L 450 290" />
                  <path d="M 150 470 L 620 470 L 620 280 L 650 280" />
                </>
              )}
            </g>

            {/* --- KOMPONENTY A TEPLOTY --- */}

            {/* Solární kolektor (S) */}
            <rect x="50" y="50" width="100" height="100" rx="10" fill="url(#solarGrad)" stroke="#b45309" strokeWidth="3" />
            <text x="100" y="95" textAnchor="middle" fill="white" fontWeight="bold" fontSize="14">Solár (S)</text>
            <rect x="30" y="120" width="80" height="24" rx="4" fill="#1e293b" />
            <text x="70" y="137" textAnchor="middle" fill={getTempColor(sim.temps.T1)} className="temp-label">
              T1: {sim.temps.T1.toFixed(1)}°
            </text>

            {/* Čerpadlo (C) */}
            <circle cx="250" cy="100" r="30" fill={sim.pump ? "#ef4444" : "#94a3b8"} stroke="#475569" strokeWidth="3" />
            <text x="250" y="105" textAnchor="middle" fill="white" fontWeight="bold" fontSize="16">C</text>

            {/* Ventil (V) */}
            <polygon points="350,80 370,100 350,120 330,100" fill="#3b82f6" stroke="#1e40af" strokeWidth="2" />
            <text x="350" y="104" textAnchor="middle" fill="white" fontWeight="bold" fontSize="12">V</text>
            <text x="310" y="70" fontSize="10" fill="#64748b" fontWeight="bold" opacity={sim.valve === 'top' ? 1 : 0.4}>DO HORNÍ</text>
            <text x="310" y="140" fontSize="10" fill="#64748b" fontWeight="bold" opacity={sim.valve === 'bottom' ? 1 : 0.4}>DO DOLNÍ</text>

            {/* Pec (P) */}
            <rect x="50" y="400" width="100" height="100" rx="10" fill="url(#fireGrad)" stroke="#334155" strokeWidth="3" />
            <text x="100" y="455" textAnchor="middle" fill="white" fontWeight="bold" fontSize="16">Pec (P)</text>
            <rect x="30" y="470" width="80" height="24" rx="4" fill="#1e293b" />
            <text x="70" y="487" textAnchor="middle" fill={getTempColor(sim.temps.Tp1)} className="temp-label">
              Tp1: {sim.temps.Tp1.toFixed(1)}°
            </text>

            {/* Nový Bojler (Nn) */}
            <rect x="450" y="50" width="120" height="300" rx="60" fill="#e0f2fe" stroke="#0284c7" strokeWidth="3" />
            <text x="510" y="35" textAnchor="middle" fill="#0284c7" fontWeight="bold">Nový Bojler (Nn)</text>
            
            {/* Spirály */}
            <path d="M 450 120 Q 480 90 510 120 T 570 120" fill="none" stroke={sim.pump && sim.valve === 'top' ? "#dc2626" : "#94a3b8"} strokeWidth="5" />
            <path d="M 450 250 Q 480 220 510 250 T 570 250" fill="none" stroke={sim.pump && sim.valve === 'bottom' ? "#dc2626" : "#94a3b8"} strokeWidth="5" />

            {/* Teploměry Nn */}
            <rect x="390" y="75" width="85" height="24" rx="4" fill="#1e293b" />
            <text x="432" y="92" textAnchor="middle" fill={getTempColor(sim.temps.T2)} className="temp-label">T2: {sim.temps.T2.toFixed(1)}°</text>
            
            <rect x="390" y="175" width="85" height="24" rx="4" fill="#1e293b" />
            <text x="432" y="192" textAnchor="middle" fill={getTempColor(sim.temps.T3)} className="temp-label">T3: {sim.temps.T3.toFixed(1)}°</text>
            
            <rect x="390" y="275" width="85" height="24" rx="4" fill="#1e293b" />
            <text x="432" y="292" textAnchor="middle" fill={getTempColor(sim.temps.T4)} className="temp-label">T4: {sim.temps.T4.toFixed(1)}°</text>

            {/* Starý Bojler (Ns) */}
            <rect x="650" y="100" width="100" height="250" rx="50" fill="#f1f5f9" stroke="#64748b" strokeWidth="3" />
            <text x="700" y="85" textAnchor="middle" fill="#64748b" fontWeight="bold">Starý (Ns)</text>
            
            {/* Teploměry Ns */}
            <rect x="710" y="125" width="85" height="24" rx="4" fill="#1e293b" />
            <text x="752" y="142" textAnchor="middle" fill={getTempColor(sim.temps.T5)} className="temp-label">T5: {sim.temps.T5.toFixed(1)}°</text>
            
            <rect x="710" y="295" width="85" height="24" rx="4" fill="#1e293b" />
            <text x="752" y="312" textAnchor="middle" fill={getTempColor(sim.temps.T6)} className="temp-label">T6: {sim.temps.T6.toFixed(1)}°</text>

          </svg>
        </div>
      </div>
    </div>
  );
}