const PdfPrinter = require('pdfmake');
const RobotoFont = require('pdfmake/build/vfs_fonts.js');
const moment = require('moment');

moment.locale('de');

function ReportPDF() {
  // constructor
}

ReportPDF.prototype.create = async function (data, persons) {

  let fonts = {
    Roboto: {
      normal: Buffer.from(RobotoFont.pdfMake.vfs['Roboto-Regular.ttf'], 'base64'),
      bold: Buffer.from(RobotoFont.pdfMake.vfs['Roboto-Medium.ttf'], 'base64'),
      italics: Buffer.from(RobotoFont.pdfMake.vfs['Roboto-Italic.ttf'], 'base64'),
      bolditalics: Buffer.from(RobotoFont.pdfMake.vfs['Roboto-MediumItalic.ttf'], 'base64')
    }
  };

  let printer = new PdfPrinter(fonts);

  this.pointsPerCentimeter = 72 / 2.54;
  this.pgSize = 'A4';
  this.pageWidthCm = 21;
  this.pageHeightCm = 29.7;

  this.pageMarginLeft = Math.floor(1.1 * this.pointsPerCentimeter);
  this.pageMarginTop = Math.floor(1.1 * this.pointsPerCentimeter);
  this.pageMarginRight = Math.floor(1.1 * this.pointsPerCentimeter);
  this.pageMarginBottom = Math.floor(1.1 * this.pointsPerCentimeter);

  this.columnGap = Math.floor(0.5 * this.pointsPerCentimeter);
  this.rightX = Math.floor(this.pageWidthCm * this.pointsPerCentimeter - this.pageMarginRight - this.pageMarginLeft);

  let self = this;

  let docDefinition = {
    footer: function (currentPage, pageCount, pageSize) {
      if (currentPage === 2) {
        return {
          text: 'Maschinisten: nach jedem Einsatz, jeder Übung und Überprüfung muss das Pumpenheft (liegt im Fahrtenbuch) ergänzt werden.',
          margin: [self.pageMarginLeft, 0, self.pageMarginRight, 0],
          fontSize: 10
        };
      } else {
        return '';
      }
    },
    header: function (currentPage, pageCount, pageSize) {
      if (currentPage === 2) {
        return {
          text: 'Atemschutzgeräteträger müssen nach jedem Einsatz einen separaten Bericht schreiben!',
          margin: [self.pageMarginLeft, self.pageMarginTop, self.pageMarginRight, 0]
        };
      } else {
        return '';
      }
    },
    pageSize: this.pgSize,

    // by default we use portrait, you can change it to landscape if you wish
    pageOrientation: 'portrait',

    // [left, top, right, bottom] or [horizontal, vertical] or just a number for equal margins
    pageMargins: [this.pageMarginLeft, this.pageMarginTop + 20, this.pageMarginRight, this.pageMarginBottom + 20],
    content: [],
    styles: {
      header1: {
        fontSize: 16,
        bold: true,
        decoration: 'underline',
        margin: [0, 0, 0, 10]
      },
      header2: {
        fontSize: 14,
        bold: true,
        margin: [0, 0, 0, 14]
      },
      horizontalLine: {
        fontSize: 24,
        margin: [0, 0, 0, 0]
      }
    },
    defaultStyle: {
      fontSize: 12,
      columnGap: this.columnGap,
      margin: [0, 10, 0, 0]
    }
  };

  docDefinition.content = this._addFirstPage(data).concat(this._addSecondPage(persons));

  let pdfDoc = printer.createPdfKitDocument(docDefinition);
  await pdfDoc.end();
  return pdfDoc;

};

ReportPDF.prototype._addFirstPage = function (data) {
  const indentX0 = 110;
  const indentX1 = 160;
  const indentX2 = 200;

  let meldung;
  if (data.keyword && data.catchword) {
    meldung = data.keyword + ', ' + data.catchword;
  } else {
    if (data.keyword) {
      meldung = data.keyword;
    }
    if (data.catchword) {
      meldung = data.catchword;
    }
  }

  let meldungDoc = {
    stack: [{stack: [{text: 'Alarmbild:'}]}, {
      canvas: [{
        type: 'line', x1: indentX1, y1: 0, x2: this.rightX, y2: 0
      }]
    }],
    margin: [0, 0, 0, 20]
  };
  if (meldung) {
    meldungDoc = [
      {
        text: 'Meldung: ' + meldung,
        style: 'header2'
      },
      {
        stack: [{stack: [{text: 'Tatsächliches Alarmbild:'}]}, {
          canvas: [{
            type: 'line', x1: indentX1, y1: 0, x2: this.rightX, y2: 0
          }]
        }],
        margin: [0, 0, 0, 20]
      }
    ];
  }

  let einsatzort;
  if (data && data.street) {
    einsatzort = [data.street, data.streetnumber, data.city, data.object].join(', ');
  }

  let einsatzortDoc = [
    {
      stack: [{stack: [{text: 'Einsatzort:'}]}, {
        canvas: [{
          type: 'line', x1: indentX1, y1: 0, x2: this.rightX, y2: 0
        }]
      }],
      style: 'header2'
    }
  ];
  if (einsatzort) {
    einsatzortDoc = {
      columns: [
        {
          width: indentX1 - this.columnGap,
          text: 'Einsatzort:',
          style: 'header2'
        },
        {
          width: '*',
          text: einsatzort
        }
      ]
    };
  }
  let emptyLinesForDescription = [];
  for (let i = 0; i < 9; i++) {
    emptyLinesForDescription.push({
      stack: [{stack: [{text: ' '}]}, {canvas: [{type: 'line', x1: 0, y1: 0, x2: this.rightX, y2: 0}]}],
      style: 'horizontalLine'
    });
  }
  emptyLinesForDescription.push({text: ' '});

  let pagetContent = [
    {
      text: 'Einsatzbericht der Freiwilligen Feuerwehr Merching vom ' + moment(data.date).format('L'),
      style: 'header1'
    },
    meldungDoc,
    einsatzortDoc,
    {
      stack: [{stack: [{text: 'Einsatzleiter:'}]}, {
        canvas: [{
          type: 'line', x1: indentX1, y1: 0, x2: this.rightX, y2: 0
        }]
      }],
      style: 'header2'
    },
    {
      text: 'Einsatzbeschreibung:',
      style: 'header2',
      margin: [0, 0, 0, 0]
    },
    {
      text: '(Was ist passiert? Was wurde gemacht? Situation beim Verlassen des Einsatzortes):'
    },
    emptyLinesForDescription,
    {
      text: [
        {text: 'Eingesetzte Fahrzeuge: ', style: 'header2'},
        {text: 'HLF [  ], LF [  ], MZF [  ], Boot [  ]'}
      ],
      margin: [0, 0, 0, 10]
    },
    {
      stack: [{stack: [{text: 'Gerettete/geborgene Personen:'}]}, {
        canvas: [{
          type: 'line', x1: indentX2, y1: 0, x2: this.rightX, y2: 0
        }]
      }],
      style: 'header2',
      margin: [0, 0, 0, 32]
    },
    {
      columns: [
        {
          width: '50%',
          stack: [
            {
              stack: [{stack: [{text: 'Beginn Einsatz:'}]}, {
                canvas: [{
                  type: 'line', x1: indentX0, y1: 0, x2: indentX0 + 130, y2: 0
                }]
              }],
              style: 'header2'
            },
            {
              stack: [{stack: [{text: 'Ende Einsatz:'}]}, {
                canvas: [{
                  type: 'line', x1: indentX0, y1: 0, x2: indentX0 + 130, y2: 0
                }]
              }],
              style: 'header2'
            },
            {
              stack: [{stack: [{text: 'Einsatzdauer:'}]}, {
                canvas: [{
                  type: 'line', x1: indentX0, y1: 0, x2: indentX0 + 130, y2: 0
                }]
              }],
              style: 'header2'
            },
            {
              stack: [{stack: [{text: 'Einsatzkräfte:'}]}, {
                canvas: [{
                  type: 'line', x1: indentX0, y1: 0, x2: indentX0 + 130, y2: 0
                }]
              }],
              style: 'header2'
            },
            {
              stack: [{stack: [{text: 'Ersteller Bericht:'}]}, {
                canvas: [{
                  type: 'line', x1: indentX0, y1: 0, x2: indentX0 + 130, y2: 0
                }]
              }],
              style: 'header2'
            },
            {
              stack: [{stack: [{text: 'Unterschrift:'}]}, {
                canvas: [{
                  type: 'line', x1: indentX0, y1: 0, x2: indentX0 + 130, y2: 0
                }]
              }],
              style: 'header2'
            }
          ]
        },
        {
          width: '50%',
          stack: [
            {text: 'Andere Dienststellen am Einsatzort:', style: 'header2'},
            {columns: [{text: '[  ] Polizei'}, {text: '[  ] Rettungsdienst'}]},
            {stack: [{text: ' ', margin: [0, 0, 0, 15]}, {canvas: [{type: 'line', x1: 0, y1: 0, x2: 250, y2: 0}]}]},
            {text: ' '},
            {text: 'Weitere Feuerwehren:', style: 'header2'},
            {stack: [{text: ' ', margin: [0, 0, 0, 0]}, {canvas: [{type: 'line', x1: 0, y1: 0, x2: 250, y2: 0}]}]},
            {stack: [{text: ' ', margin: [0, 0, 0, 15]}, {canvas: [{type: 'line', x1: 0, y1: 0, x2: 250, y2: 0}]}]},
            {stack: [{text: ' ', margin: [0, 0, 0, 15]}, {canvas: [{type: 'line', x1: 0, y1: 0, x2: 250, y2: 0}]}]}
          ],
        }
      ]
    }

  ];
  return pagetContent;
};

ReportPDF.prototype._addSecondPage = function (persons) {
  let indexToSplit = Math.floor((persons.length + 1) / 2);

  let first = persons.slice(0, indexToSplit);
  let second = persons.slice(indexToSplit);

  console.log(`Number of persons: ${persons.length}, first: ${first.length}, second: ${second.length}`);
  let body = [];
  body.push([
    {text: 'A', bold: true}, {text: 'Name', bold: true}, {text: 'Unterschrift', bold: true}, '', {
      text: 'A', bold: true
    },
    {text: 'Name', bold: true},
    {text: 'Unterschrift', bold: true}
  ]);
  let cnt = first.length > second.length ? first.length : second.length;
  for (let i = 0; i < cnt; i++) {
    let f = persons[i] ? persons[i].lastname + ', ' + persons[i].firstname : '';
    let r = persons[i + first.length] ? persons[i + first.length].lastname + ', ' + persons[i + first.length].firstname : '';
    body.push(['[  ]', f, '', '', '[  ]', r, ''])
  }

  let pageContent = [
    {
      table: {
        widths: [13, 110, '*', 5, 13, 110, '*'],
        body: body
      },
      pageBreak: 'before'
    }
  ];
  return pageContent;
};

ReportPDF.create = async function (data, persons) {
  let r = new ReportPDF();
  return await r.create(data, persons);
};

module.exports = ReportPDF;
