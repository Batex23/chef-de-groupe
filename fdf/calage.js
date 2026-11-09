// Vitesse de tete (m/h) par peuplement et par vent, comparee a la regle du memento SDIS 33 :
// « Vent : vitesse en m/s x 100 = Vpropagation en m/h » (fiche 1.2.2 : <= 7 m/s -> <= 700 m/h ...).
const FEU = require('../src/fdf/feu.js');
const noms = ['', 'Agricole', 'Prairie', 'Landes', 'Coupe rase', 'Semis 0-5', 'Pins 5-10', 'Pins 10-20', 'Pins 20-40', 'Pins +40', 'Feuillus', 'Ages divers', 'Jardins', 'Marais'];
const cal = +process.argv[2] || 1, sech = process.argv[3] || 'forte';
const vents = [3, 5, 7, 10, 14, 21];
console.log('secheresse', sech, 'calage', cal);
console.log('peuplement'.padEnd(12), vents.map(v => (v + ' m/s').padStart(14)).join(''));
for (let f = 1; f < FEU.PEUP.length; f++) {
  const row = vents.map(v => {
    const F = new FEU.Feu({ w: 1, h: 1, res: 10, fuel: new Uint8Array([f]), alt: new Uint8Array(1), haut: new Uint8Array(1) }, { vent: v, secheresse: sech, calage: cal });
    const T = F.tab[f]; const I = F.headIntensity(f), cr = F.crown(f);
    return `${Math.round(T.R * 60)}m/h ${Math.round(I)}${cr ? (cr === 2 ? 'C' : 'c') : ''}`.padStart(14);
  });
  console.log(noms[f].padEnd(12), row.join(''));
}
console.log('regle memento'.padEnd(12), vents.map(v => (v * 100 + 'm/h').padStart(14)).join(''));
