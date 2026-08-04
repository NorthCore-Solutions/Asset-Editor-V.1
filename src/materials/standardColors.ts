export interface StandardColor {
  name: string;
  hex: string;
}

export const STANDARD_COLOR_COLUMNS = 7;

const COLOR_NAMES = [
  'Dunkelviolett', 'Dämmerungsblau', 'Tiefblau', 'Kräftiges Blau', 'Königsblau', 'Lavendelblau', 'Helles Lavendel',
  'Marineblau-Violett', 'Aubergine', 'Traube', 'Violett', 'Lila', 'Zartes Violett', 'Helles Lila',
  'Dunkle Pflaume', 'Tiefes Violett', 'Samtig Lila', 'Kräftiges Lila', 'Amethyst', 'Malve', 'Helllila',
  'Dunkles Rubin', 'Pflaume', 'Helles Lila', 'Strahlendes Violett', 'Magenta', 'Blassviolett', 'Flieder',
  'Tiefes Amethyst', 'Karminrot', 'Maulbeere', 'Helles Pink', 'Pink', 'Nelkenrosa', 'Zuckerwatte Pink',
  'Tiefes Purpurrot', 'Kirschholz', 'Kirschrot', 'Tomatenrot', 'Erdbeerrosa', 'Helle Koralle', 'Rosenwasser',
  'Kastanienbraun', 'Dunkelrot', 'Kirschrot', 'Knallrot', 'Korallenrot', 'Koralle', 'Pastellrosa',
  'Rotbraun', 'Rostbraun', 'Korallenorange', 'Lachsfarben', 'Orange', 'Apricot', 'Pfirsich',
  'Sattes Braun', 'Mittleres Braun', 'Dunkelorange', 'Warmes Orange', 'Pfirsich', 'Elfenbein', 'Vanille',
  'Goldbraun', 'Sonnenscheingold', 'Sonnengelb', 'Helle Zitrone', 'Gelb', 'Löwenzahn', 'Hellgelb',
  'Tiefes Moos', 'Moosgrün', 'Helles Khaki', 'Helles Grün', 'Limette', 'Helle Limette', 'Pastell-Limette',
  'Tiefgrün', 'Waldgrün', 'Spritzige Limette', 'Grasgrün', 'Elektrogrün', 'Pastellgrün', 'Frühlingsnebel',
  'Smaragdgrüne Nacht', 'Grüner Nebel', 'Grün', 'Meerschaum', 'Meeresbrise', 'Eiskalt', 'Eisiges Blaugrün',
  'Tiefes Smaragdgrün', 'Tiefsee', 'Bergwiese', 'Zartes Blaugrün', 'Helle Jade', 'Gletscherblau', 'Hellblau',
  'Evergreen', 'Tiefes Indigo', 'Tropisches Blaugrün', 'Kristall-Lagune', 'Türkisblau', 'Frostige Minze', 'Heller Himmel',
  'Mitternachtsblaugrün', 'Tiefes Blaugrün', 'Dunkeltürkis', 'Aquablau', 'Strahlender Himmel', 'Aquamarinblau', 'Weißes Eis',
  'Dunkles Ozeanblau', 'Dunkles Blaugrün', 'Helles Blau', 'Hellblau', 'Kristallblau', 'Puderblau', 'Mattierte Minze',
  'Tiefsee', 'Meeresblau', 'Kobaltblau', 'Saphirblau', 'Zartblau', 'Eisblau', 'Blassblau'
] as const;

const COLOR_HEX_VALUES = [
  '#000B3D', '#00167A', '#0025CC', '#1F48FF', '#5271FF', '#99ACFF', '#C2CDFF',
  '#020C45', '#2C0A71', '#4910BC', '#5E17EB', '#8C52FF', '#BEA1F7', '#D8C7FA',
  '#200934', '#401268', '#6B1FAD', '#9440DD', '#B174E7', '#CEA8F0', '#E2CBF6',
  '#2B0934', '#561269', '#8F1EAE', '#BC3FDE', '#CB6CE6', '#E1A8F0', '#EDCBF6',
  '#3D0026', '#7A004B', '#CC007E', '#FF1FA9', '#FF66C4', '#FF99D8', '#FFC2E8',
  '#330A0A', '#661414', '#FF2828', '#FF3A3A', '#FF5050', '#FFADAD', '#FFD6D6',
  '#3D0000', '#7A0000', '#CC0000', '#FF3131', '#FF5757', '#FF9999', '#FFC2C2',
  '#3D1700', '#7A2F00', '#CC4E00', '#FF751F', '#FF914D', '#FFC099', '#FFD9C2',
  '#3D2500', '#7A4900', '#CC7A00', '#FFA51F', '#FFBD59', '#FFD699', '#FFE7C2',
  '#3D3100', '#7A6200', '#CCA300', '#FFD21F', '#FFDE59', '#FFEB99', '#FFF3C2',
  '#233D00', '#457A00', '#74CC00', '#9EFF1F', '#C1FF72', '#D3FF99', '#E4FFC2',
  '#17320B', '#2E6417', '#4CA626', '#7ED957', '#99E17A', '#BFECAC', '#D9F4CD',
  '#003D20', '#007A3F', '#00BF63', '#1FFF93', '#5CFFB0', '#99FFCE', '#C2FFE1',
  '#053827', '#0A714E', '#10BB82', '#31EDAE', '#69F2C4', '#A1F7DA', '#C7FAE9',
  '#083335', '#11676A', '#1CABB0', '#3DDBE1', '#5CE1E6', '#A7EFF1', '#CAF5F7',
  '#00343D', '#00687A', '#0097B2', '#0CC0DF', '#5CE7FF', '#99F0FF', '#C2F6FF',
  '#00273D', '#004E7A', '#0081CC', '#38B6FF', '#70CBFF', '#99DAFF', '#C2E9FF',
  '#001B3D', '#00357A', '#004AAD', '#1F80FF', '#5CA3FF', '#99C5FF', '#C2DCFF'
] as const;

export const STANDARD_FULL_COLORS: readonly StandardColor[] = COLOR_HEX_VALUES.map((hex, index) => ({
  hex,
  name: COLOR_NAMES[index] ?? hex
}));

export const STANDARD_COLOR_PREVIEW: readonly StandardColor[] = [
  { name: 'Weiß', hex: '#FFFFFF' },
  { name: 'Schwarz', hex: '#11161A' },
  { name: 'Knallrot', hex: '#FF3131' },
  { name: 'Lachsfarben', hex: '#FF751F' },
  { name: 'Sonnengelb', hex: '#FFD21F' },
  { name: 'Grün', hex: '#00BF63' },
  { name: 'Aquablau', hex: '#0CC0DF' },
  { name: 'Kräftiges Blau', hex: '#1F48FF' },
  { name: 'Lila', hex: '#8C52FF' },
  { name: 'Helles Pink', hex: '#FF1FA9' }
];
