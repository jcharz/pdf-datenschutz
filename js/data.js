// Wortlisten für die Erkennung von Namen und für glaubwürdige Ersatzwerte (Pseudonyme).

export const FIRST_NAMES_F = [
  'Alexandra', 'Alina', 'Andrea', 'Angelika', 'Anja', 'Anna', 'Anne', 'Annette', 'Antje', 'Barbara', 'Beate', 'Bettina',
  'Birgit', 'Brigitte', 'Carina', 'Carolin', 'Caroline', 'Charlotte', 'Christa', 'Christiane', 'Christina', 'Christine',
  'Claudia', 'Cornelia', 'Dagmar', 'Daniela', 'Diana', 'Doris', 'Dorothea', 'Elena', 'Elisabeth', 'Ella', 'Emilia', 'Emma',
  'Erika', 'Eva', 'Franziska', 'Frieda', 'Gabriele', 'Gisela', 'Hanna', 'Hannah', 'Heike', 'Helga', 'Ilse', 'Ines', 'Inge',
  'Ingrid', 'Iris', 'Jana', 'Janina', 'Jasmin', 'Jessica', 'Johanna', 'Julia', 'Jutta', 'Karin', 'Katharina', 'Kathrin',
  'Katja', 'Kerstin', 'Klara', 'Lara', 'Laura', 'Lea', 'Lena', 'Lina', 'Lisa', 'Luisa', 'Maja', 'Manuela', 'Mareike', 'Maria',
  'Marie', 'Marina', 'Marion', 'Martina', 'Melanie', 'Mia', 'Michaela', 'Monika', 'Nadine', 'Natalie', 'Nicole', 'Nina',
  'Petra', 'Renate', 'Ruth', 'Sabine', 'Sabrina', 'Sandra', 'Sara', 'Sarah', 'Silke', 'Simone', 'Sofia', 'Sophie', 'Stefanie',
  'Stephanie', 'Susanne', 'Svenja', 'Tanja', 'Ursula', 'Ute', 'Vanessa', 'Vera', 'Verena', 'Yvonne',
];

export const FIRST_NAMES_M = [
  'Achim', 'Alexander', 'Andreas', 'Anton', 'Armin', 'Axel', 'Ben', 'Benjamin', 'Bernd', 'Björn', 'Christian', 'Christoph',
  'Daniel', 'David', 'Dennis', 'Detlef', 'Dieter', 'Dirk', 'Dominik', 'Elias', 'Emil', 'Erik', 'Fabian', 'Felix', 'Finn',
  'Florian', 'Frank', 'Franz', 'Friedrich', 'Georg', 'Gerhard', 'Günter', 'Hans', 'Harald', 'Heinz', 'Helmut', 'Henrik',
  'Herbert', 'Holger', 'Horst', 'Ingo', 'Jan', 'Jens', 'Joachim', 'Johannes', 'Jonas', 'Jörg', 'Josef', 'Julian', 'Jürgen',
  'Kai', 'Karl', 'Klaus', 'Konstantin', 'Lars', 'Leon', 'Lukas', 'Luca', 'Manfred', 'Marc', 'Marcel', 'Marco', 'Mario',
  'Markus', 'Martin', 'Mathias', 'Matthias', 'Max', 'Maximilian', 'Michael', 'Moritz', 'Niklas', 'Nils', 'Noah', 'Norbert',
  'Oliver', 'Oskar', 'Patrick', 'Paul', 'Peter', 'Philipp', 'Rainer', 'Ralf', 'René', 'Richard', 'Robert', 'Roland', 'Rolf',
  'Sebastian', 'Simon', 'Stefan', 'Stephan', 'Sven', 'Thomas', 'Thorsten', 'Tim', 'Tobias', 'Tom', 'Torsten', 'Udo', 'Uwe',
  'Volker', 'Walter', 'Werner', 'Wolfgang', 'Yannick',
];

// Häufige Nachnamen – nur für Ersatzwerte, nicht für die Erkennung
export const LAST_NAMES = [
  'Albrecht', 'Arnold', 'Bauer', 'Baumann', 'Beck', 'Becker', 'Berger', 'Brandt', 'Braun', 'Busch', 'Dietrich', 'Engel',
  'Fischer', 'Frank', 'Franke', 'Friedrich', 'Fuchs', 'Graf', 'Günther', 'Haas', 'Hahn', 'Hartmann', 'Heinrich', 'Herrmann',
  'Hoffmann', 'Hofmann', 'Horn', 'Huber', 'Jung', 'Kaiser', 'Keller', 'Klein', 'Koch', 'Köhler', 'König', 'Krämer', 'Kraus',
  'Krause', 'Krüger', 'Kuhn', 'Lang', 'Lange', 'Lehmann', 'Lorenz', 'Ludwig', 'Maier', 'Martin', 'Mayer', 'Meier', 'Möller',
  'Morgenstern', 'Neumann', 'Otto', 'Peters', 'Pohl', 'Roth', 'Sauer', 'Schäfer', 'Scharf', 'Schmid', 'Schmidt', 'Schmitt',
  'Schmitz', 'Schneider', 'Scholz', 'Schröder', 'Schubert', 'Schulte', 'Schulz', 'Schulze', 'Schumacher', 'Schwarz',
  'Seidel', 'Simon', 'Sommer', 'Stein', 'Thomas', 'Vogel', 'Vogt', 'Wagner', 'Walter', 'Weber', 'Weiß', 'Werner', 'Winkler',
  'Winter', 'Wolf', 'Zimmermann',
];

export const FIRST_NAMES = new Set([...FIRST_NAMES_F, ...FIRST_NAMES_M]);
export const FEMALE = new Set(FIRST_NAMES_F);

export const STREETS = [
  'Ahornweg', 'Am Mühlbach', 'Amselstraße', 'Bachstraße', 'Bahnhofstraße', 'Bergstraße', 'Birkenweg', 'Blumenstraße',
  'Buchenweg', 'Dorfstraße', 'Eichenweg', 'Feldstraße', 'Finkenweg', 'Gartenstraße', 'Goethestraße', 'Hauptstraße',
  'Hirschgasse', 'Kastanienallee', 'Kirchstraße', 'Lindenstraße', 'Marktplatz', 'Mittelweg', 'Mühlenweg', 'Parkstraße',
  'Rosenweg', 'Schillerstraße', 'Schulstraße', 'Sonnenweg', 'Talstraße', 'Tulpenweg', 'Waldstraße', 'Wiesenweg',
];

export const CITIES = [
  'Altdorf', 'Bergheim', 'Birkenfeld', 'Blumenthal', 'Eichstetten', 'Felsberg', 'Grünstadt', 'Hainburg', 'Heidenau',
  'Hochdorf', 'Kirchberg', 'Lindau', 'Marienfeld', 'Neustadt', 'Rosenthal', 'Schönau', 'Sonnenberg', 'Steinbach',
  'Talheim', 'Waldkirch', 'Weidenau', 'Wiesental',
];

// Große E-Mail-Anbieter verraten nichts über die Person – diese Domains bleiben erhalten.
export const PUBLIC_MAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'web.de', 'gmx.de', 'gmx.net', 'gmx.at', 'gmx.ch', 't-online.de', 'outlook.com',
  'outlook.de', 'hotmail.com', 'hotmail.de', 'live.com', 'live.de', 'yahoo.com', 'yahoo.de', 'icloud.com', 'me.com',
  'mac.com', 'posteo.de', 'mailbox.org', 'freenet.de', 'aol.com', 'aol.de', 'arcor.de', 'proton.me', 'protonmail.com',
]);

export const FAKE_MAIL_DOMAINS = ['beispiel.de', 'mail-beispiel.de', 'postfach-beispiel.de', 'example.org'];
