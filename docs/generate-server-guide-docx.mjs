/**
 * Guide Word — bonnes pratiques serveur (gérants / équipe).
 * node docs/generate-server-guide-docx.mjs
 */
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  LevelFormat,
  AlignmentType,
  BorderStyle,
  WidthType,
  Table,
  TableRow,
  TableCell,
  ShadingType,
  TabStopType,
  TabStopPosition,
} from 'docx';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.join(__dirname, 'Guide-bonnes-pratiques-serveur.docx');

const PAGE_W = 9360; // contenu utile ~6,5"
const ink = '222222';
const faint = '666666';
const line = 'CCCCCC';
const headFill = 'F2F2F2';

const cellBorder = {
  top: { style: BorderStyle.SINGLE, size: 1, color: line },
  bottom: { style: BorderStyle.SINGLE, size: 1, color: line },
  left: { style: BorderStyle.SINGLE, size: 1, color: line },
  right: { style: BorderStyle.SINGLE, size: 1, color: line },
};

function para(children, spacing = { after: 120, line: 264 }) {
  const runs = typeof children === 'string'
    ? [new TextRun({ text: children, font: 'Calibri', size: 21, color: ink })]
    : children;
  return new Paragraph({ spacing, children: runs });
}

function title(text) {
  return new Paragraph({
    spacing: { after: 60 },
    children: [new TextRun({ text, font: 'Calibri', size: 34, bold: true, color: ink })],
  });
}

function section(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 240, after: 100 },
    children: [new TextRun({ text, font: 'Calibri', size: 24, bold: true, color: ink })],
  });
}

function sub(text) {
  return new Paragraph({
    spacing: { before: 160, after: 60 },
    children: [new TextRun({ text, font: 'Calibri', size: 22, bold: true, color: ink })],
  });
}

function li(text, ref = 'ul') {
  return new Paragraph({
    numbering: { reference: ref, level: 0 },
    spacing: { after: 60, line: 264 },
    children: [new TextRun({ text, font: 'Calibri', size: 21, color: ink })],
  });
}

function rule() {
  return new Paragraph({
    spacing: { before: 200, after: 200 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: line, space: 1 } },
    children: [],
  });
}

function tableCell(text, width, { header = false, bold = false } = {}) {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    shading: header ? { type: ShadingType.CLEAR, fill: headFill } : undefined,
    borders: cellBorder,
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    children: [
      para([
        new TextRun({
          text,
          font: 'Calibri',
          size: 20,
          bold: header || bold,
          color: ink,
        }),
      ], { after: 0, line: 240 }),
    ],
  });
}

function dataRow(cols, widths) {
  return new TableRow({
    children: cols.map((t, i) => tableCell(t, widths[i], { bold: i === 0 })),
  });
}

const doc = new Document({
  styles: {
    default: {
      document: {
        run: { font: 'Calibri', size: 21 },
      },
    },
  },
  numbering: {
    config: [
      {
        reference: 'ul',
        levels: [{
          level: 0,
          format: LevelFormat.BULLET,
          text: '–',
          alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 540, hanging: 360 } } },
        }],
      },
      {
        reference: 'chk',
        levels: [{
          level: 0,
          format: LevelFormat.BULLET,
          text: '☐',
          alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 540, hanging: 360 } } },
        }],
      },
    ],
  },
  sections: [{
    properties: {
      page: {
        margin: { top: 1260, right: 1260, bottom: 1260, left: 1260 },
      },
    },
    children: [
      title('Serveur POSR — bonnes pratiques'),
      para([
        new TextRun({ text: 'Pour gérants et responsables d’établissement. ', font: 'Calibri', size: 20, color: faint }),
        new TextRun({ text: 'Installation technique : support ou intégrateur.', font: 'Calibri', size: 20, color: faint }),
      ], { after: 180 }),

      section('Le serveur, en bref'),
      para('Machine qui centralise les données (commandes, menu, employés, stock). Caisses et tablettes s’y connectent en réseau.'),

      section('Comptes'),
      li('Un PIN ou mot de passe par personne — jamais de code commun.'),
      li('Changer les codes par défaut le jour J.'),
      li('Désactiver le compte le jour où quelqu’un quitte.'),
      li('Donner le minimum de droits (caisse, cuisine, admin).'),
      li('Verrouiller ou se déconnecter si le poste est laissé seul.'),
      sub('Mots de passe admin'),
      li('Réservés au gérant ou à 1–2 responsables.'),
      li('Pas de post-it, pas de groupe WhatsApp.'),

      section('Sauvegardes'),
      li('Sauvegarde automatique : au moins une fois par jour.'),
      li('Contrôler une fois par semaine qu’un fichier récent existe.'),
      li('Copie hors restaurant (autre site ou stockage sécurisé).'),
      li('Sauvegarde manuelle avant toute mise à jour majeure.'),

      section('Réseau et machine'),
      li('Serveur dans un local fermé, pas en salle.'),
      li('Tablettes sur le Wi‑Fi staff, pas le Wi‑Fi clients.'),
      li('Ne pas éteindre le serveur pendant le service.'),
      li('Pas de logiciels perso sur la machine serveur.'),

      section('Chaque service'),
      sub('Ouverture'),
      li('Test : connexion, une commande test, ticket cuisine, ticket caisse.'),
      sub('Fermeture'),
      li('Clôture caisse / journée selon votre procédure interne.'),

      section('Mise en service (checklist)'),
      li('Changer tous les codes par défaut.', 'chk'),
      li('Créer les comptes et rôles.', 'chk'),
      li('Menus, tables, paiements, imprimantes.', 'chk'),
      li('Parcours complet : commande → cuisine → paiement → ticket.', 'chk'),
      li('Confirmer qu’une sauvegarde fonctionne.', 'chk'),
      li('Former l’équipe (ouverture, vente, fermeture).', 'chk'),

      section('Pannes — ordre des vérifications'),
      new Table({
        width: { size: PAGE_W, type: WidthType.DXA },
        columnWidths: [2800, 6560],
        rows: [
          new TableRow({
            children: [
              tableCell('Problème', 2800, { header: true }),
              tableCell('Action', 6560, { header: true }),
            ],
          }),
          dataRow(['Connexion impossible', 'Wi‑Fi staff OK ? Serveur allumé ? Ne pas créer de comptes au hasard.'], [2800, 6560]),
          dataRow(['Cuisine sans commandes', 'Écran cuisine + réseau. Commande test. Support si > 10 min.'], [2800, 6560]),
          dataRow(['Pas de ticket', 'Papier, alimentation, câble. Impression test dans réglages.'], [2800, 6560]),
          dataRow(['Carte refusée', 'Terminal + Internet. Appliquer procédure espèces si définie.'], [2800, 6560]),
          dataRow(['Coupure de courant', 'Attendre fin du redémarrage serveur, puis commande test.'], [2800, 6560]),
          dataRow(['Internet coupé', 'Continuer la vente si la caisse répond ; noter l’heure, rappeler support si anormal.'], [2800, 6560]),
        ],
      }),

      section('À ne pas faire'),
      li('Compte « directeur » partagé par toute l’équipe.'),
      li('Ignorer les alertes sauvegarde ou connexion plusieurs jours.'),
      li('Redémarrer tout le système sans raison en plein service.'),

      section('Responsabilités (à noter sur une page)'),
      new Table({
        width: { size: PAGE_W, type: WidthType.DXA },
        columnWidths: [3200, 6160],
        rows: [
          new TableRow({
            children: [
              tableCell('Rôle', 3200, { header: true }),
              tableCell('Nom / contact', 6160, { header: true }),
            ],
          }),
          dataRow(['Comptes employés', ''], [3200, 6160]),
          dataRow(['Codes admin serveur', ''], [3200, 6160]),
          dataRow(['Contrôle sauvegardes', ''], [3200, 6160]),
          dataRow(['Urgence service (téléphone)', ''], [3200, 6160]),
        ],
      }),

      rule(),
      new Paragraph({
        tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
        children: [
          new TextRun({ text: 'POSR', font: 'Calibri', size: 18, color: faint }),
          new TextRun({ text: '\t', font: 'Calibri', size: 18 }),
          new TextRun({
            text: new Date().toLocaleDateString('fr-CA'),
            font: 'Calibri',
            size: 18,
            color: faint,
          }),
        ],
      }),
    ],
  }],
});

const buffer = await Packer.toBuffer(doc);
fs.writeFileSync(outPath, buffer);
console.log('Wrote', outPath);
