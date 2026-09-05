// Nigeria geography — 37 states (36 + FCT) + 774 LGAs
// Single source of truth for state/LGA data. Used by FacilityDiscovery filters
// and by resolveLocation to centre searches.

export const NIGERIA_STATES = [
  { name: 'Abia', lgas: ['Aba North','Aba South','Arochukwu','Bende','Ikwuano','Isiala Ngwa North','Isiala Ngwa South','Isuikwuato','Obi Ngwa','Ohafia','Osisioma Ngwa','Ugwunagbo','Ukwa East','Ukwa West','Umuahia North','Umuahia South','Umu Nneochi'] },
  { name: 'Adamawa', lgas: ['Demsa','Fufore','Ganye','Girei','Gombi','Guyuk','Hong','Jada','Lamurde','Madagali','Maiha','Mayo-Belwa','Michika','Mubi North','Mubi South','Numan','Shelleng','Song','Toungo','Yola North','Yola South'] },
  { name: 'Akwa Ibom', lgas: ['Abak','Eastern Obolo','Eket','Esit Eket','Essien Udim','Etim Ekpo','Etinan','Ibeno','Ibesikpo Asutan','Ibiono-Ibom','Ika','Ikono','Ikot Abasi','Ikot Ekpene','Ini','Itu','Mbo','Mkpat-Enin','Nsit-Atai','Nsit-Ibom','Nsit-Ubium','Obot Akara','Okobo','Onna','Oron','Oruk Anam','Udung-Uko','Ukanafun','Uruan','Urue-Offong/Oruko','Uyo'] },
  { name: 'Anambra', lgas: ['Aguata','Anambra East','Anambra West','Anaocha','Awka North','Awka South','Ayamelum','Dunukofia','Ekwusigo','Idemili North','Idemili South','Ihiala','Njikoka','Nnewi North','Nnewi South','Ogbaru','Onitsha North','Onitsha South','Orumba North','Orumba South','Oyi'] },
  { name: 'Bauchi', lgas: ['Alkaleri','Bauchi','Bogoro','Damban','Darazo','Dass','Gamawa','Ganjuwa','Giade','Itas/Gadau','Jama\'are','Katagum','Kirfi','Misau','Ningi','Shira','Tafawa Balewa','Toro','Warji','Zaki'] },
  { name: 'Bayelsa', lgas: ['Brass','Ekeremor','Kolokuma/Opokuma','Nembe','Ogbia','Sagbama','Southern Ijaw','Yenagoa'] },
  { name: 'Benue', lgas: ['Ado','Agatu','Apa','Buruku','Gboko','Guma','Gwer East','Gwer West','Katsina-Ala','Konshisha','Kwande','Logo','Makurdi','Obi','Ogbadibo','Ohimini','Oju','Okpokwu','Otukpo','Tarka','Ukum','Ushongo','Vandeikya'] },
  { name: 'Borno', lgas: ['Abadam','Askira/Uba','Bama','Bayo','Biu','Chibok','Damboa','Dikwa','Gubio','Guzamala','Gwoza','Hawul','Jere','Kaga','Kala/Balge','Konduga','Kukawa','Kwaya Kusar','Mafa','Magumeri','Maiduguri','Marte','Mobbar','Monguno','Ngala','Nganzai','Shani'] },
  { name: 'Cross River', lgas: ['Abi','Akamkpa','Akpabuyo','Bakassi','Bekwarra','Biase','Boki','Calabar Municipal','Calabar South','Etung','Ikom','Obanliku','Obubra','Obudu','Odukpani','Ogoja','Yakurr','Yala'] },
  { name: 'Delta', lgas: ['Aniocha North','Aniocha South','Bomadi','Burutu','Ethiope East','Ethiope West','Ika North East','Ika South','Isoko North','Isoko South','Ndokwa East','Ndokwa West','Okpe','Oshimili North','Oshimili South','Patani','Sapele','Udu','Ughelli North','Ughelli South','Ukwuani','Uvwie','Warri North','Warri South','Warri South West'] },
  { name: 'Ebonyi', lgas: ['Abakaliki','Afikpo North','Afikpo South','Ebonyi','Ezza North','Ezza South','Ikwo','Ishielu','Ivo','Izzi','Ohaozara','Ohaukwu','Onicha'] },
  { name: 'Edo', lgas: ['Akoko-Edo','Egor','Esan Central','Esan North-East','Esan South-East','Esan West','Etsako Central','Etsako East','Etsako West','Igueben','Ikpoba Okha','Orhionmwon','Oredo','Ovia North-East','Ovia South-West','Owan East','Owan West','Uhunmwonde'] },
  { name: 'Ekiti', lgas: ['Ado Ekiti','Efon','Ekiti East','Ekiti South-West','Ekiti West','Emure','Gbonyin','Ido Osi','Ijero','Ikere','Ikole','Ilejemeje','Irepodun/Ifelodun','Ise/Orun','Moba','Oye'] },
  { name: 'Enugu', lgas: ['Aninri','Awgu','Enugu East','Enugu North','Enugu South','Ezeagu','Igbo Etiti','Igbo Eze North','Igbo Eze South','Isi Uzo','Nkanu East','Nkanu West','Nsukka','Oji River','Udenu','Udi','Uzo Uwani'] },
  { name: 'FCT', lgas: ['Abaji','Abuja Municipal Area Council','Bwari','Gwagwalada','Kuje','Kwali'] },
  { name: 'Gombe', lgas: ['Akko','Balanga','Billiri','Dukku','Funakaye','Gombe','Kaltungo','Kwami','Nafada','Shongom','Yamaltu/Deba'] },
  { name: 'Imo', lgas: ['Aboh Mbaise','Ahiazu Mbaise','Ehime Mbano','Ezinihitte','Ideato North','Ideato South','Ihitte/Uboma','Ikeduru','Isiala Mbano','Isu','Mbaitoli','Ngor Okpala','Njaba','Nkwerre','Nwangele','Obowo','Oguta','Ohaji/Egbema','Okigwe','Orlu','Orsu','Oru East','Oru West','Owerri Municipal','Owerri North','Owerri West','Unuimo'] },
  { name: 'Jigawa', lgas: ['Auyo','Babura','Biriniwa','Birnin Kudu','Buji','Dutse','Gagarawa','Garki','Gumel','Guri','Gwaram','Gwiwa','Hadejia','Jahun','Kafin Hausa','Kaugama','Kazaure','Kiri Kasama','Kiyawa','Maigatari','Malam Madori','Miga','Ringim','Roni','Sule Tankarkar','Taura','Yankwashi'] },
  { name: 'Kaduna', lgas: ['Birnin Gwari','Chikun','Giwa','Igabi','Ikara','Jaba','Jema\'a','Kachia','Kaduna North','Kaduna South','Kagarko','Kajuru','Kaura','Kauru','Kubau','Kudan','Lere','Makarfi','Sabon Gari','Sanga','Soba','Zangon Kataf','Zaria'] },
  { name: 'Kano', lgas: ['Ajingi','Albasu','Bagwai','Bebeji','Bichi','Bunkure','Dala','Dambatta','Dawakin Kudu','Dawakin Tofa','Doguwa','Fagge','Gabasawa','Garko','Garun Mallam','Gaya','Gezawa','Gwale','Gwarzo','Kabo','Kano Municipal','Karaye','Kibiya','Kiru','Kumbotso','Kunchi','Kura','Madobi','Makoda','Minjibir','Nasarawa','Rano','Rimin Gado','Rogo','Shanono','Sumaila','Takai','Tarauni','Tofa','Tsanyawa','Tudun Wada','Ungogo','Warawa','Wudil'] },
  { name: 'Katsina', lgas: ['Bakori','Batagarawa','Batsari','Baure','Bindawa','Charanchi','Dan Musa','Dandume','Danja','Daura','Dutsi','Dutsin Ma','Faskari','Funtua','Ingawa','Jibia','Kafur','Kaita','Kankara','Kankia','Katsina','Kurfi','Kusada','Mai\'Adua','Malumfashi','Mani','Mashi','Matazu','Musawa','Rimi','Sabuwa','Safana','Sandamu','Zango'] },
  { name: 'Kebbi', lgas: ['Aleiro','Arewa Dandi','Argungu','Augie','Bagudo','Birnin Kebbi','Bunza','Dandi','Fakai','Gwandu','Jega','Kalgo','Koko/Besse','Maiyama','Ngaski','Sakaba','Shanga','Suru','Wasagu/Danko','Yauri','Zuru'] },
  { name: 'Kogi', lgas: ['Adavi','Ajaokuta','Ankpa','Bassa','Dekina','Ibaji','Idah','Igalamela Odolu','Ijumu','Kabba/Bunu','Kogi','Lokoja','Mopa Muro','Ofu','Ogori/Magongo','Okehi','Okene','Olamaboro','Omala','Yagba East','Yagba West'] },
  { name: 'Kwara', lgas: ['Asa','Baruten','Edu','Ekiti','Ifelodun','Ilorin East','Ilorin South','Ilorin West','Irepodun','Isin','Kaiama','Moro','Offa','Oke Ero','Oyun','Pategi'] },
  { name: 'Lagos', lgas: ['Agege','Ajeromi-Ifelodun','Alimosho','Amuwo-Odofin','Apapa','Badagry','Epe','Eti Osa','Ibeju-Lekki','Ifako-Ijaiye','Ikeja','Ikorodu','Kosofe','Lagos Island','Lagos Mainland','Mushin','Ojo','Oshodi-Isolo','Shomolu','Surulere'] },
  { name: 'Nasarawa', lgas: ['Akwanga','Awe','Doma','Karu','Keana','Keffi','Kokona','Lafia','Nasarawa','Nasarawa Egon','Obi','Toto','Wamba'] },
  { name: 'Niger', lgas: ['Agaie','Agwara','Bida','Borgu','Bosso','Chanchaga','Edati','Gbako','Gurara','Katcha','Kontagora','Lapai','Lavun','Magama','Mariga','Mashegu','Mokwa','Munya','Paikoro','Rafi','Rijau','Shiroro','Suleja','Tafa','Wushishi'] },
  { name: 'Ogun', lgas: ['Abeokuta North','Abeokuta South','Ado-Odo/Ota','Ewekoro','Ifo','Ijebu East','Ijebu North','Ijebu North East','Ijebu Ode','Ikenne','Imeko Afon','Ipokia','Obafemi Owode','Odogbolu','Odeda','Ogun Waterside','Remo North','Sagamu','Yewa North','Yewa South'] },
  { name: 'Ondo', lgas: ['Akoko North-East','Akoko North-West','Akoko South-West','Akoko South-East','Akure North','Akure South','Ese Odo','Idanre','Ifedore','Ilaje','Ile Oluji/Okeigbo','Irele','Odigbo','Okitipupa','Ondo East','Ondo West','Ose','Owo'] },
  { name: 'Osun', lgas: ['Atakunmosa East','Atakunmosa West','Aiyedaade','Aiyedire','Boluwaduro','Boripe','Ede North','Ede South','Egbedore','Ejigbo','Ife Central','Ife East','Ife North','Ife South','Ifedayo','Ifelodun','Ila','Ilesa East','Ilesa West','Irepodun','Irewole','Isokan','Iwo','Obokun','Odo Otin','Ola Oluwa','Olorunda','Oriade','Orolu','Osogbo'] },
  { name: 'Oyo', lgas: ['Afijio','Akinyele','Atiba','Atisbo','Egbeda','Ibadan North','Ibadan North-East','Ibadan North-West','Ibadan South-East','Ibadan South-West','Ibarapa Central','Ibarapa East','Ibarapa North','Ido','Irepo','Iseyin','Itesiwaju','Iwajowa','Kajola','Lagelu','Ogbomosho North','Ogbomosho South','Ogo Oluwa','Olorunsogo','Oluyole','Ona Ara','Orelope','Ori Ire','Oyo East','Oyo West','Saki East','Saki West','Surulere'] },
  { name: 'Plateau', lgas: ['Barkin Ladi','Bassa','Bokkos','Jos East','Jos North','Jos South','Kanam','Kanke','Langtang North','Langtang South','Mangu','Mikang','Pankshin','Qua\'an Pan','Riyom','Shendam','Wase'] },
  { name: 'Rivers', lgas: ['Abua/Odual','Ahoada East','Ahoada West','Akuku-Toru','Andoni','Asari-Toru','Bonny','Degema','Eleme','Emohua','Etche','Gokana','Ikwerre','Khana','Obio/Akpor','Ogba/Egbema/Ndoni','Ogu/Bolo','Okrika','Omuma','Opobo/Nkoro','Oyigbo','Port Harcourt','Tai'] },
  { name: 'Sokoto', lgas: ['Binji','Bodinga','Dange Shuni','Gada','Goronyo','Gudu','Gwadabawa','Illela','Isa','Kebbe','Kware','Rabah','Sabon Birni','Shagari','Silame','Sokoto North','Sokoto South','Tambuwal','Tangaza','Tureta','Wamako','Wurno','Yabo'] },
  { name: 'Taraba', lgas: ['Ardo Kola','Bali','Donga','Gashaka','Gassol','Ibi','Jalingo','Karim Lamido','Kurmi','Lau','Sardauna','Takum','Ussa','Wukari','Yorro','Zing'] },
  { name: 'Yobe', lgas: ['Bade','Bursari','Damaturu','Fika','Fune','Geidam','Gujba','Gulani','Jakusko','Karasuwa','Machina','Nangere','Nguru','Potiskum','Tarmuwa','Yunusari','Yusufari'] },
  { name: 'Zamfara', lgas: ['Anka','Bakura','Birnin Magaji/Kaura Namoda','Bukkuyum','Bungudu','Chafe','Gummi','Gusau','Kaura Namoda','Maradun','Maru','Shinkafi','Talata Mafara','Zurmi'] },
]

// FCT variants — treat "FCT", "FCT Abuja", "FCT - Abuja", "Federal Capital Territory" as same
const STATE_ALIASES = {
  'fct': 'FCT',
  'fct abuja': 'FCT',
  'fct - abuja': 'FCT',
  'federal capital territory': 'FCT',
  'abuja': 'FCT',
}

const stateMap = new Map(NIGERIA_STATES.map(s => [s.name.toLowerCase(), s.name]))
// Fill alias map
for (const [k,v] of Object.entries(STATE_ALIASES)) stateMap.set(k, v)

// Optional centre coordinates for states (approx capital centroids) for fallback when Nominatim fails or offline
export const STATE_CENTRES = {
  'Abia': { lat: 5.4527, lng: 7.5248 },
  'Adamawa': { lat: 9.3265, lng: 12.3984 },
  'Akwa Ibom': { lat: 5.0077, lng: 7.8537 },
  'Anambra': { lat: 6.2209, lng: 7.0677 },
  'Bauchi': { lat: 10.7761, lng: 9.8228 },
  'Bayelsa': { lat: 4.7719, lng: 6.0699 },
  'Benue': { lat: 7.3369, lng: 8.7404 },
  'Borno': { lat: 11.8848, lng: 13.1517 },
  'Cross River': { lat: 5.8702, lng: 8.5988 },
  'Delta': { lat: 5.5324, lng: 5.8987 },
  'Ebonyi': { lat: 6.2649, lng: 8.0137 },
  'Edo': { lat: 6.6342, lng: 5.9303 },
  'Ekiti': { lat: 7.719, lng: 5.311 },
  'Enugu': { lat: 6.4584, lng: 7.5464 },
  'FCT': { lat: 9.0765, lng: 7.3986 },
  'Gombe': { lat: 10.2897, lng: 11.1671 },
  'Imo': { lat: 5.572, lng: 7.0588 },
  'Jigawa': { lat: 12.228, lng: 9.561 },
  'Kaduna': { lat: 10.5105, lng: 7.4165 },
  'Kano': { lat: 12.0022, lng: 8.592 },
  'Katsina': { lat: 12.3796, lng: 7.6302 },
  'Kebbi': { lat: 12.4504, lng: 4.1997 },
  'Kogi': { lat: 7.8004, lng: 6.7405 },
  'Kwara': { lat: 8.9669, lng: 4.3874 },
  'Lagos': { lat: 6.5244, lng: 3.3792 },
  'Nasarawa': { lat: 8.5378, lng: 8.3206 },
  'Niger': { lat: 9.9309, lng: 5.5983 },
  'Ogun': { lat: 7.1604, lng: 3.3483 },
  'Ondo': { lat: 7.2571, lng: 5.2058 },
  'Osun': { lat: 7.5629, lng: 4.520 },
  'Oyo': { lat: 8.119, lng: 3.4192 },
  'Plateau': { lat: 9.2182, lng: 9.5179 },
  'Rivers': { lat: 4.8582, lng: 6.9209 },
  'Sokoto': { lat: 13.0667, lng: 5.2339 },
  'Taraba': { lat: 8.8937, lng: 11.3608 },
  'Yobe': { lat: 12.2939, lng: 11.4397 },
  'Zamfara': { lat: 12.122, lng: 6.2236 },
}

export function normalizeState(input) {
  if (!input) return null
  const raw = String(input).trim().toLowerCase()
  if (!raw) return null
  // Direct alias
  if (stateMap.has(raw)) return stateMap.get(raw)
  // normalize dashes/spaces
  const cleaned = raw.replace(/-/g, ' ').replace(/\s+/g, ' ').trim()
  if (stateMap.has(cleaned)) return stateMap.get(cleaned)
  return null
}

export function getLgasForState(state) {
  const canon = normalizeState(state)
  if (!canon) return []
  const entry = NIGERIA_STATES.find(s => s.name === canon)
  return entry ? [...entry.lgas] : []
}

export function allStates() {
  return NIGERIA_STATES.map(s => s.name)
}

// Resolve a location request into { centre, boundary, state, lga, city, label }
// - mode: 'current' | 'selected' | 'state' | 'lga' | 'city' | 'area' | 'nigeria'
// - For point modes (current/selected), centre is coords.
// - For boundary modes (state/lga/city/area), we attempt Nominatim geocode for bbox/centre.
// - For nigeria, centre is national centroid, boundary is null (partitioned search)
export async function resolveLocation({ mode, state, lga, city, area, coords } = {}) {
  const m = (mode || 'current').toLowerCase()
  // Nigeria-wide
  if (m === 'nigeria') {
    return {
      centre: { lat: 9.082, lng: 8.6753 },
      boundary: null,
      state: null,
      lga: null,
      city: null,
      label: 'Nigeria',
      mode: 'nigeria',
    }
  }
  // State / LGA / City / Area need centre via geocode
  if (['state','lga','city','area','selected'].includes(m)) {
    const canonState = normalizeState(state)
    let query = ''
    let label = ''
    if (m === 'state' && canonState) {
      query = canonState + ', Nigeria'
      label = canonState
    } else if (m === 'lga' && lga && canonState) {
      query = lga + ', ' + canonState + ', Nigeria'
      label = lga + ', ' + canonState
    } else if (m === 'lga' && lga) {
      query = lga + ', Nigeria'
      label = lga
    } else if ((m === 'city' || m === 'area') && (city || area)) {
      const place = city || area
      query = place + (canonState ? ', ' + canonState : '') + ', Nigeria'
      label = place + (canonState ? ', ' + canonState : '')
    } else if (m === 'selected' && coords) {
      return {
        centre: { lat: Number(coords.lat), lng: Number(coords.lng) },
        boundary: null,
        state: canonState || null,
        lga: lga || null,
        city: city || area || null,
        label: label || (canonState || 'Selected location'),
        mode: m,
      }
    }
    // Fallback to state centre if we have one
    if (canonState && !query) {
      query = canonState + ', Nigeria'
      label = canonState
    }
    if (query) {
      try {
        const geocoded = await geocodeLocation(query)
        if (geocoded) return { ...geocoded, state: canonState || geocoded.state || null, lga: lga || null, city: city || area || geocoded.city || null, label: geocoded.label || label, mode: m }
      } catch (e) {
        // fallback to centre
      }
      if (canonState && STATE_CENTRES[canonState]) {
        return {
          centre: { ...STATE_CENTRES[canonState] },
          boundary: null,
          state: canonState,
          lga: lga || null,
          city: city || area || null,
          label,
          mode: m,
        }
      }
    }
    // If we have coords, use them
    if (coords && Number.isFinite(coords.lat) && Number.isFinite(coords.lng)) {
      return {
        centre: { lat: Number(coords.lat), lng: Number(coords.lng) },
        boundary: null,
        state: canonState || null,
        lga: lga || null,
        city: city || area || null,
        label: label || 'Selected area',
        mode: m,
      }
    }
    return { centre: null, boundary: null, state: canonState || null, lga: lga || null, city: city || area || null, label: label || null, mode: m }
  }
  // Current / Nearby / default — GPS centred
  if (coords && Number.isFinite(coords.lat) && Number.isFinite(coords.lng)) {
    let label = null
    // Do not block — attempt reverse but return quickly
    // Caller can use label if resolved; if not, fallback to coordinates string
    return {
      centre: { lat: Number(coords.lat), lng: Number(coords.lng) },
      boundary: null,
      state: normalizeState(state) || null,
      lga: lga || null,
      city: city || null,
      label: label || (state ? normalizeState(state) : null),
      mode: m,
    }
  }
  // No coords — try to geocode state if provided
  if (state) {
    const canon = normalizeState(state)
    if (canon && STATE_CENTRES[canon]) {
      return { centre: { ...STATE_CENTRES[canon] }, boundary: null, state: canon, lga: lga || null, city: city || null, label: canon, mode: m }
    }
  }
  return { centre: null, boundary: null, state: normalizeState(state) || null, lga: lga || null, city: city || null, label: null, mode: m }
}

// Nominatim forward geocode for location centre/boundary
async function geocodeLocation(query) {
  if (!query) return null
  const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&addressdetails=1&polygon_geojson=0&q=' + encodeURIComponent(query)
  const res = await fetch(url, { headers: { 'Accept': 'application/json' } })
  if (!res.ok) return null
  const data = await res.json()
  if (!Array.isArray(data) || data.length === 0) return null
  const item = data[0]
  const lat = parseFloat(item.lat)
  const lon = parseFloat(item.lon)
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  let boundary = null
  if (Array.isArray(item.boundingbox) && item.boundingbox.length === 4) {
    // Nominatim bbox: [south, north, west, east] as strings
    const south = parseFloat(item.boundingbox[0])
    const north = parseFloat(item.boundingbox[1])
    const west = parseFloat(item.boundingbox[2])
    const east = parseFloat(item.boundingbox[3])
    if ([south,north,west,east].every(Number.isFinite)) {
      boundary = { south, north, west, east }
    }
  }
  const addr = item.address || {}
  const state = addr.state || null
  const city = addr.city || addr.town || addr.village || addr.county || null
  return {
    centre: { lat, lng: lon },
    boundary,
    state: normalizeState(state) || state || null,
    city,
    lga: null,
    label: item.display_name || query,
  }
}

// Quick synchronous centre lookup without network — for pagination/partitioning hints
export function centreForState(state) {
  const canon = normalizeState(state)
  if (!canon) return null
  return STATE_CENTRES[canon] || null
}

export function centreForLga(state, lga) {
  // LGA-level centre would need geocode; return state centre as approximation
  return centreForState(state)
}
