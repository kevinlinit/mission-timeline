/**
 * The studio's route catalog: the starting points planners tailor from. Each route is a set of stops
 * with what's worth doing there, and traits (0 to 1) the questionnaire answers are matched against.
 *
 * Traits, matching the questionnaire's activity rows:
 *   nature, beach, onsen, mountains, history, crafts, events, photo, art, active
 * and also:
 *   city      0 = rural, 1 = big city             famous  0 = local secrets, 1 = the classics
 *   food      how much the food is the point       night   evening atmosphere
 * Flags say what a route leans on, so the matcher can warn about fears and things to avoid:
 *   bike, boat, heights (ropeways, cliff paths), climb, snow, remote (patchy signal), beachside
 * `months` are the best months to go (1-12); `seasonNote` says why the others are harder.
 *
 * Edit freely: add a route, change a stop, retune a trait. The matcher reads only this file.
 */
export const ROUTES = [
  {
    id: "kyushu-onsen", emoji: "♨️", name: "Kyushu: volcanoes and hot springs", region: "Kyushu",
    pitch: "Steaming spa towns, a living volcano and slow ryokan nights, ending in Fukuoka's food stalls.",
    traits: { nature: 0.8, beach: 0.2, onsen: 1, mountains: 0.7, history: 0.4, crafts: 0.5, events: 0.3, photo: 0.7, art: 0.2, active: 0.4, city: 0.3, famous: 0.3, food: 0.8, night: 0.5 },
    flags: { heights: 0.3, remote: 0.3 }, months: [3, 4, 5, 10, 11, 12],
    prefectures: ["Fukuoka", "Oita", "Kumamoto"],
    stops: [
      { place: "Fukuoka", weight: 2, highlights: ["Ohori Park and the old castle walls", "Dinner: Nakasu yatai food stalls", "Yanagibashi market breakfast", "Dazaifu Tenmangu shrine and its plum-cake street"], rain: "Fukuoka Asian Art Museum" },
      { place: "Beppu", weight: 2, highlights: ["The hells of Kannawa: steam vents and jigoku-mushi cooking", "Sand bath at Takegawara", "Myoban hot-spring village", "Dinner: Oita toriten and dango-jiru"], rain: "Bamboo craft centre workshop" },
      { place: "Kurokawa Onsen", weight: 2, highlights: ["Rotemburo hopping with a wooden pass", "Kaiseki dinner at the ryokan", "Riverside lantern walk", "Nabegataki waterfall"], rain: "Long soak and a reading afternoon in the ryokan" },
      { place: "Aso", weight: 1, highlights: ["Kusasenri grasslands walk", "Aso crater rim (if the gas level allows)", "Daikanbo lookout over the caldera", "Lunch: akaushi beef bowl"], rain: "Aso Volcano Museum" },
    ],
  },
  {
    id: "kumano-kodo", emoji: "⛩️", name: "Kii Peninsula: the Kumano pilgrimage", region: "Kansai",
    pitch: "A temple night on Koyasan, then forest trails between grand shrines and riverside hot springs.",
    traits: { nature: 1, beach: 0.3, onsen: 0.8, mountains: 0.8, history: 0.9, crafts: 0.4, events: 0.4, photo: 0.8, art: 0.1, active: 0.7, city: 0.05, famous: 0.3, food: 0.4, night: 0.1 },
    flags: { climb: 0.6, remote: 0.7, heights: 0.2 }, months: [3, 4, 5, 10, 11],
    seasonNote: "June is the rainy season and July-August are very hot on the trail.",
    prefectures: ["Wakayama", "Nara"],
    stops: [
      { place: "Koyasan", weight: 1, highlights: ["Night walk through Okunoin cemetery", "Shukubo temple stay with shojin-ryori dinner", "Dawn prayers at the temple", "Danjo Garan and Kongobu-ji"], rain: "Reihokan treasure museum" },
      { place: "Kumano Kodo trail", weight: 2, highlights: ["Takijiri-oji to Chikatsuyu on the Nakahechi route", "Kumano Hongu Taisha and the giant torii", "Tsuboyu, the bath you take in turns", "Kawayu: dig your own river bath"], rain: "Kumano Hongu heritage centre and a short trail section" },
      { place: "Nachi", weight: 1, highlights: ["Daimon-zaka stone steps", "Nachi Falls and the pagoda", "Seiganto-ji temple", "Lunch: tuna in Katsuura harbour"], rain: "Kumano Nachi Taisha and its treasure hall" },
      { place: "Shirahama", weight: 1, highlights: ["Sandanbeki cliffs", "Saki-no-yu seaside bath", "Shirarahama white beach at sunset", "Dinner: Wakayama ramen"], rain: "Shirahama aquarium and Adventure World (pandas)" },
    ],
  },
  {
    id: "japan-alps", emoji: "🏔️", name: "The Japan Alps and old post towns", region: "Chubu",
    pitch: "Alpine valleys, a thatched-roof village and the merchant streets of Takayama and Kanazawa.",
    traits: { nature: 0.9, beach: 0, onsen: 0.6, mountains: 1, history: 0.8, crafts: 0.8, events: 0.5, photo: 0.9, art: 0.6, active: 0.6, city: 0.3, famous: 0.6, food: 0.6, night: 0.3 },
    flags: { heights: 0.4, climb: 0.3, snow: 0.3 }, months: [5, 6, 7, 8, 9, 10],
    seasonNote: "Kamikochi is closed from mid-November to mid-April.",
    prefectures: ["Nagano", "Gifu", "Ishikawa", "Toyama"],
    stops: [
      { place: "Matsumoto", weight: 1, highlights: ["Matsumoto Castle, the black crow", "Nakamachi storehouse street", "Lunch: Shinshu soba", "Daio wasabi farm"], rain: "Japan Ukiyo-e Museum" },
      { place: "Kamikochi", weight: 1, highlights: ["Taisho Pond to Kappa Bridge walk", "Myojin Pond and the shrine", "Lunch: char grilled by the river", "Evening at a lodge in the valley"], rain: "Shirahone onsen instead of the valley" },
      { place: "Takayama", weight: 2, highlights: ["Morning markets on the river", "Sanmachi old town and sake breweries", "Hida Folk Village", "Dinner: Hida beef"], rain: "Takayama festival floats museum" },
      { place: "Shirakawa-go", weight: 1, highlights: ["Gassho-zukuri farmhouses", "Shiroyama viewpoint over the village", "Night in a thatched farmhouse"], rain: "Wada house museum" },
      { place: "Kanazawa", weight: 2, highlights: ["Kenroku-en garden", "Higashi Chaya teahouse district", "Gold-leaf workshop", "Omicho market seafood", "21st Century Museum"], rain: "D.T. Suzuki Museum and the Nagamachi samurai houses" },
    ],
  },
  {
    id: "setouchi-art", emoji: "🎨", name: "Setouchi: art islands and the inland sea", region: "Setouchi",
    pitch: "Museums set into island hills, ferry hops between fishing towns and a bike ride over the sea.",
    traits: { nature: 0.6, beach: 0.8, onsen: 0.2, mountains: 0.2, history: 0.5, crafts: 0.5, events: 0.4, photo: 0.9, art: 1, active: 0.5, city: 0.3, famous: 0.4, food: 0.6, night: 0.2 },
    flags: { boat: 0.8, bike: 0.6, beachside: 0.4 }, months: [3, 4, 5, 9, 10, 11],
    prefectures: ["Okayama", "Kagawa", "Hiroshima"],
    stops: [
      { place: "Okayama and Kurashiki", weight: 1, highlights: ["Korakuen garden", "Kurashiki canal quarter", "Ohara Museum of Art", "Lunch: Okayama barazushi"], rain: "Ohara Museum of Art" },
      { place: "Naoshima", weight: 2, highlights: ["Chichu Art Museum", "Benesse House Museum", "The yellow pumpkin pier", "Art House Project in Honmura", "I♥湯 bathhouse"], rain: "Chichu and Lee Ufan museums (book ahead)" },
      { place: "Teshima", weight: 1, highlights: ["Teshima Art Museum", "Cycle the island's terraced rice fields", "Lunch: island café"], rain: "Teshima Art Museum, then ferry back early" },
      { place: "Onomichi and the Shimanami Kaido", weight: 1, highlights: ["Temple walk above Onomichi", "Cycle the Shimanami bridges to Ikuchijima", "Lunch: Onomichi ramen", "Kosanji temple and the marble hill"], rain: "Onomichi temples and cafés" },
      { place: "Hiroshima and Miyajima", weight: 2, highlights: ["Peace Memorial Park and museum", "Itsukushima shrine at high tide", "Mount Misen ropeway", "Dinner: Hiroshima okonomiyaki"], rain: "Peace Memorial Museum" },
    ],
  },
  {
    id: "tohoku-north", emoji: "🍂", name: "Tohoku: the deep north", region: "Tohoku",
    pitch: "Pine islands, golden temples, a gaslit onsen town and samurai lanes, far from the crowds.",
    traits: { nature: 0.8, beach: 0.3, onsen: 0.9, mountains: 0.6, history: 0.8, crafts: 0.7, events: 0.7, photo: 0.8, art: 0.2, active: 0.4, city: 0.25, famous: 0.15, food: 0.6, night: 0.2 },
    flags: { remote: 0.5, snow: 0.3, boat: 0.3 }, months: [4, 5, 6, 8, 9, 10, 11],
    seasonNote: "Early August has the big summer festivals (Nebuta, Kanto, Tanabata): book months ahead.",
    prefectures: ["Miyagi", "Iwate", "Yamagata", "Akita"],
    stops: [
      { place: "Sendai and Matsushima", weight: 1, highlights: ["Matsushima bay cruise", "Zuigan-ji temple", "Dinner: gyutan grilled beef tongue"], rain: "Zuiho-den mausoleum and the Sendai media library" },
      { place: "Hiraizumi", weight: 1, highlights: ["Chuson-ji and the Golden Hall", "Motsu-ji pure land garden", "Geibikei gorge boat (boatman's songs)"], rain: "Hiraizumi cultural heritage centre" },
      { place: "Ginzan Onsen", weight: 1, highlights: ["Gaslit wooden inns at dusk", "Shirogane waterfall walk", "Ryokan kaiseki dinner"], rain: "Old silver mine tunnel walk" },
      { place: "Yamadera", weight: 1, highlights: ["1,015 steps up Risshaku-ji", "Basho's haiku stone", "Lunch: Yamagata imoni stew"], rain: "Yamadera Basho memorial museum" },
      { place: "Kakunodate", weight: 1, highlights: ["Samurai district lanes", "Cherry-bark (kabazaiku) craft workshop", "Tamachi merchant quarter"], rain: "Aoyagi samurai house museum" },
    ],
  },
  {
    id: "golden-route", emoji: "🗼", name: "The classic first trip", region: "Honshu",
    pitch: "Tokyo's neighbourhoods, a night in Hakone, then Kyoto, Nara and Osaka: the icons, done well.",
    traits: { nature: 0.4, beach: 0, onsen: 0.5, mountains: 0.3, history: 0.9, crafts: 0.7, events: 0.6, photo: 0.9, art: 0.6, active: 0.2, city: 0.9, famous: 1, food: 0.9, night: 0.9 },
    flags: { heights: 0.2 }, months: [3, 4, 5, 10, 11, 12],
    prefectures: ["Tokyo", "Kanagawa", "Kyoto", "Nara", "Osaka"],
    stops: [
      { place: "Tokyo", weight: 3, highlights: ["Asakusa and Senso-ji at opening", "Yanaka old town walk", "Meiji Jingu and Harajuku", "teamLab Planets", "Dinner: izakaya in Omoide Yokocho", "Shibuya Sky at dusk"], rain: "Tokyo National Museum and Ueno" },
      { place: "Hakone", weight: 1, highlights: ["Hakone loop: train, cable car, Owakudani, Lake Ashi boat", "Open-Air Museum", "Ryokan onsen night"], rain: "Pola Museum of Art" },
      { place: "Kyoto", weight: 3, highlights: ["Fushimi Inari at dawn", "Higashiyama lanes to Kiyomizu-dera", "Arashiyama bamboo and Okochi Sanso", "Nishiki market", "Gion at dusk", "Tea ceremony"], rain: "Kyoto National Museum and a tea ceremony" },
      { place: "Nara", weight: 1, highlights: ["Todai-ji great Buddha", "Nara Park deer", "Naramachi old merchant quarter"], rain: "Nara National Museum" },
      { place: "Osaka", weight: 1, highlights: ["Dotonbori street food crawl", "Kuromon market", "Osaka Castle park", "Shinsekai kushikatsu"], rain: "Osaka Museum of Housing and Living" },
    ],
  },
  {
    id: "shikoku-valleys", emoji: "🌉", name: "Shikoku: vine bridges and pilgrim temples", region: "Shikoku",
    pitch: "Hidden valleys with vine bridges, the Pacific coast of Kochi and Japan's oldest hot spring.",
    traits: { nature: 1, beach: 0.5, onsen: 0.7, mountains: 0.8, history: 0.6, crafts: 0.5, events: 0.5, photo: 0.8, art: 0.3, active: 0.7, city: 0.15, famous: 0.15, food: 0.7, night: 0.4 },
    flags: { heights: 0.6, boat: 0.4, remote: 0.7, climb: 0.4 }, months: [3, 4, 5, 10, 11],
    prefectures: ["Kagawa", "Tokushima", "Kochi", "Ehime"],
    stops: [
      { place: "Takamatsu", weight: 1, highlights: ["Ritsurin garden", "Udon crawl: three shops", "Konpira-san's 785 steps"], rain: "Udon-making class" },
      { place: "Iya Valley", weight: 2, highlights: ["Kazurabashi vine bridge", "Oboke gorge boat", "Ochiai village viewpoint", "Night in a restored farmhouse"], rain: "Peeing Boy statue lookout and a long farmhouse lunch" },
      { place: "Kochi", weight: 1, highlights: ["Sunday street market", "Hirome market: seared bonito", "Katsurahama beach", "Kochi Castle"], rain: "Hirome market and the castle" },
      { place: "Matsuyama", weight: 2, highlights: ["Dogo Onsen Honkan", "Matsuyama Castle by ropeway", "Ishite-ji pilgrim temple", "Uchiko old town"], rain: "Dogo Onsen and the Botchan karakuri clock" },
    ],
  },
  {
    id: "hokkaido-wild", emoji: "🦌", name: "Hokkaido: wide skies and wild coast", region: "Hokkaido",
    pitch: "Sapporo and Otaru's seafood, flower fields or powder snow, then the wild Shiretoko peninsula.",
    traits: { nature: 1, beach: 0.3, onsen: 0.7, mountains: 0.8, history: 0.3, crafts: 0.3, events: 0.5, photo: 0.9, art: 0.3, active: 0.8, city: 0.35, famous: 0.4, food: 0.9, night: 0.5 },
    flags: { snow: 0.6, remote: 0.6, boat: 0.4, climb: 0.4 }, months: [1, 2, 6, 7, 8, 9],
    seasonNote: "Winter is for snow lovers (and drift ice in February); summer is for hiking and flowers.",
    prefectures: ["Hokkaido"],
    stops: [
      { place: "Sapporo", weight: 2, highlights: ["Nijo market breakfast", "Odori Park and the TV tower", "Dinner: Genghis Khan lamb", "Ramen Yokocho"], rain: "Sapporo Beer Museum" },
      { place: "Otaru", weight: 1, highlights: ["Canal walk", "Glassblowing workshop", "Sushi street"], rain: "Music box museum and a glassblowing workshop" },
      { place: "Furano and Biei", weight: 2, highlights: ["Blue Pond", "Patchwork Road by bike or car", "Farm Tomita lavender (July)", "Asahidake ropeway walk"], rain: "Furano cheese factory and a winery" },
      { place: "Shiretoko", weight: 2, highlights: ["Five Lakes boardwalk", "Shiretoko cruise for bears and whales", "Kamuiwakka hot waterfall", "Dinner: Rausu kelp and crab"], rain: "Shiretoko nature centre film and Utoro onsen" },
    ],
  },
  {
    id: "sanin-coast", emoji: "🌊", name: "San'in: Japan's quiet sea coast", region: "Chugoku",
    pitch: "The gods' shrine at Izumo, a castle town on a lake, sand dunes, and the onsen town of Kinosaki.",
    traits: { nature: 0.7, beach: 0.7, onsen: 0.9, mountains: 0.3, history: 0.8, crafts: 0.6, events: 0.5, photo: 0.8, art: 0.6, active: 0.4, city: 0.15, famous: 0.15, food: 0.7, night: 0.3 },
    flags: { boat: 0.4, beachside: 0.4 }, months: [4, 5, 6, 9, 10, 11],
    seasonNote: "November to March is crab season in Kinosaki (and some winter storms on the coast).",
    prefectures: ["Shimane", "Tottori", "Hyogo"],
    stops: [
      { place: "Izumo", weight: 1, highlights: ["Izumo Taisha grand shrine", "Inasa beach at sunset", "Lunch: Izumo soba"], rain: "Shimane Museum of Ancient Izumo" },
      { place: "Matsue", weight: 2, highlights: ["Matsue Castle and the moat boat", "Adachi Museum gardens", "Lake Shinji sunset", "Tea and wagashi at Meimei-an"], rain: "Adachi Museum of Art" },
      { place: "Tottori", weight: 1, highlights: ["Tottori sand dunes", "Sand Museum", "Uradome coast boat"], rain: "Sand Museum" },
      { place: "Kinosaki Onsen", weight: 2, highlights: ["Seven public baths in yukata", "Willow-lined canal at night", "Kani crab kaiseki (in season)", "Ropeway to Onsen-ji"], rain: "Bath-hopping is perfect in the rain" },
    ],
  },
  {
    id: "okinawa-islands", emoji: "🏝️", name: "Okinawa and the Yaeyama islands", region: "Okinawa",
    pitch: "Ryukyu castles, coral beaches and slow island days on Ishigaki and Taketomi.",
    traits: { nature: 0.8, beach: 1, onsen: 0, mountains: 0.2, history: 0.5, crafts: 0.6, events: 0.4, photo: 0.9, art: 0.2, active: 0.5, city: 0.2, famous: 0.3, food: 0.6, night: 0.4 },
    flags: { boat: 0.8, beachside: 1 }, months: [3, 4, 5, 10, 11],
    seasonNote: "June to October is typhoon season; boats and flights can be cancelled.",
    prefectures: ["Okinawa"],
    stops: [
      { place: "Naha", weight: 1, highlights: ["Shuri Castle", "Makishi public market", "Tsuboya pottery street", "Dinner: Okinawan izakaya with sanshin music"], rain: "Okinawa Prefectural Museum" },
      { place: "Ishigaki", weight: 2, highlights: ["Kabira Bay glass-bottom boat", "Snorkelling with manta rays (May-Oct)", "Tamatorizaki viewpoint", "Dinner: Ishigaki beef"], rain: "Yaeyama museum and a minsah weaving workshop" },
      { place: "Taketomi", weight: 1, highlights: ["Water-buffalo cart through the village", "Kondoi beach", "Star-sand at Kaiji beach", "Night in a red-tiled minshuku"], rain: "Taketomi visitor centre and a slow lunch" },
      { place: "Iriomote", weight: 1, highlights: ["Kayak up the Urauchi river", "Pinaisara falls walk", "Yubu island by buffalo cart"], rain: "Mangrove river boat" },
    ],
  },
];

/** The questionnaire's activity rows, and the trait each one is matched to. */
export const ACTIVITY_TRAITS = {
  "Gentle walks and time in nature": "nature",
  "Beaches and coastal areas": "beach",
  "Hot springs and wellness time": "onsen",
  "Mountains": "mountains",
  "Historical sights": "history",
  "Hands-on cultural experiences and workshops": "crafts",
  "Local traditional events": "events",
  "Photogenic, visually charming places": "photo",
  "Artistic and creative attractions (museums, exhibitions)": "art",
  "Active or intense experiences (full-day hiking, biking, snow activities)": "active",
};
