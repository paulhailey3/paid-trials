import { useState, useEffect } from 'react'
import './App.css'

// Parse trial data from ClinicalTrials.gov API
function parseTrialData(study) {
  const p = study.protocolSection || {};
  const id = p.identificationModule || {};
  const status = p.statusModule || {};
  const design = p.designModule || {};
  const sponsors = p.sponsorCollaboratorsModule || {};
  const conds = p.conditionsModule || {};
  const interventions = p.armsInterventionsModule || {};
  const eligibility = p.eligibilityModule || {};
  const contacts = p.contactsLocationsModule || {};
  const desc = p.descriptionModule || {};

  const centralContact = contacts.centralContacts?.[0];
  const locationContacts = contacts.locations?.[0]?.contacts?.[0];
  const bestContact = centralContact || locationContacts;

  // Check for compensation mentions
  const fullText = (desc.briefSummary || '') + ' ' + (desc.detailedDescription || '') + ' ' + (eligibility.eligibilityCriteria || '');
  const textLower = fullText.toLowerCase();

  const compensationInfo = detectCompensation(textLower, fullText);
  const healthyVolunteers = eligibility.healthyVolunteers === 'Yes';

  return {
    id: id.nctId || '',
    title: id.briefTitle || 'Untitled Study',
    phase: design.phases?.join(', ') || 'Not specified',
    status: status.overallStatus || 'Unknown',
    sponsor: sponsors.leadSponsor?.name || 'Unknown Sponsor',
    sponsorType: sponsors.leadSponsor?.class || '',
    conditions: conds.conditions || [],
    interventions: interventions.interventions?.map(i => i.name).join(', ') || 'Not specified',
    interventionType: interventions.interventions?.[0]?.type || '',
    description: desc.briefSummary || '',
    eligibility: {
      criteria: eligibility.eligibilityCriteria || '',
      minAge: eligibility.minimumAge || 'Not specified',
      maxAge: eligibility.maximumAge || 'Not specified',
      sex: eligibility.sex || 'All',
      healthyVolunteers
    },
    locations: (contacts.locations || []).slice(0, 5).map(loc => ({
      facility: loc.facility || 'Unknown Facility',
      city: loc.city || '',
      state: loc.state || '',
      country: loc.country || ''
    })),
    contact: bestContact ? {
      name: bestContact.name || '',
      phone: bestContact.phone || '',
      email: bestContact.email || ''
    } : null,
    enrollment: status.enrollmentInfo?.count || null,
    compensation: compensationInfo,
    healthyVolunteers,
    likelyPaid: compensationInfo.mentioned || healthyVolunteers
  };
}

// Detect compensation details from text
function detectCompensation(textLower, fullText) {
  const hasCompensation = textLower.includes('compensat') ||
    textLower.includes('reimburs') ||
    textLower.includes('paid') ||
    textLower.includes('payment') ||
    textLower.includes('stipend') ||
    /\$\d+/.test(fullText);

  // Try to extract dollar amounts
  const amountMatch = fullText.match(/\$(\d+(?:,\d{3})*(?:\.\d{2})?)/g);
  const amounts = amountMatch ? amountMatch.map(a => a) : [];

  // Try to find per-visit or total amounts
  let estimatedPay = null;
  if (amounts.length > 0) {
    const highest = amounts.map(a => parseFloat(a.replace(/[$,]/g, ''))).sort((a, b) => b - a)[0];
    estimatedPay = highest;
  }

  return {
    mentioned: hasCompensation,
    amounts,
    estimatedPay
  };
}

// Study type categories for filtering
const studyTypes = [
  { id: 'all', label: 'All Studies', icon: '📋' },
  { id: 'healthy', label: 'Healthy Volunteers', icon: '💪' },
  { id: 'drug', label: 'Drug Studies', icon: '💊' },
  { id: 'device', label: 'Device Studies', icon: '🔧' },
  { id: 'vaccine', label: 'Vaccine Trials', icon: '💉' },
  { id: 'behavioral', label: 'Behavioral/Survey', icon: '📝' }
];

// Main App Component
function App() {
  const [trials, setTrials] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [filters, setFilters] = useState({
    location: '',
    studyType: 'all',
    ageRange: 'all',
    sex: 'all'
  });
  const [showFilters, setShowFilters] = useState(false);

  // Search for paid trials
  const searchTrials = async () => {
    setLoading(true);
    setSearched(true);

    try {
      // Build query for healthy volunteer and paid studies
      let query = 'AREA[HealthyVolunteers]Yes OR AREA[BriefSummary]compensation OR AREA[BriefSummary]paid OR AREA[BriefSummary]reimbursement';

      // Add location filter
      let locationFilter = '';
      if (filters.location) {
        locationFilter = `&filter.locationSearch=${encodeURIComponent(filters.location)}`;
      }

      // Add sex filter
      let sexFilter = '';
      if (filters.sex !== 'all') {
        sexFilter = `&filter.sex=${filters.sex === 'male' ? 'MALE' : 'FEMALE'}`;
      }

      // Age filter
      let ageFilter = '';
      if (filters.ageRange !== 'all') {
        const ageRanges = {
          '18-30': { min: '18 Years', max: '30 Years' },
          '31-50': { min: '31 Years', max: '50 Years' },
          '51-65': { min: '51 Years', max: '65 Years' },
          '65+': { min: '65 Years', max: '100 Years' }
        };
        const range = ageRanges[filters.ageRange];
        if (range) {
          // Age filtering is complex in the API, we'll filter client-side
        }
      }

      const url = `https://clinicaltrials.gov/api/v2/studies?query.term=${encodeURIComponent(query)}&filter.overallStatus=RECRUITING${locationFilter}${sexFilter}&pageSize=50&fields=protocolSection`;

      const response = await fetch(url);
      const data = await response.json();

      let parsedTrials = (data.studies || []).map(parseTrialData);

      // Filter by study type
      if (filters.studyType !== 'all') {
        parsedTrials = parsedTrials.filter(t => {
          const type = t.interventionType?.toLowerCase() || '';
          const desc = t.description?.toLowerCase() || '';

          switch (filters.studyType) {
            case 'healthy':
              return t.healthyVolunteers;
            case 'drug':
              return type.includes('drug') || type.includes('biological');
            case 'device':
              return type.includes('device');
            case 'vaccine':
              return desc.includes('vaccine') || desc.includes('immunization');
            case 'behavioral':
              return type.includes('behavioral') || type.includes('other') || desc.includes('survey') || desc.includes('questionnaire');
            default:
              return true;
          }
        });
      }

      // Filter by age if specified
      if (filters.ageRange !== 'all') {
        const userAge = {
          '18-30': 24,
          '31-50': 40,
          '51-65': 58,
          '65+': 70
        }[filters.ageRange];

        parsedTrials = parsedTrials.filter(t => {
          const minAge = parseInt(t.eligibility.minAge) || 0;
          const maxAge = parseInt(t.eligibility.maxAge) || 120;
          return userAge >= minAge && userAge <= maxAge;
        });
      }

      // Sort by likelihood of payment (healthy volunteers first, then those mentioning compensation)
      parsedTrials.sort((a, b) => {
        // Healthy volunteer studies first
        if (a.healthyVolunteers && !b.healthyVolunteers) return -1;
        if (!a.healthyVolunteers && b.healthyVolunteers) return 1;

        // Then by compensation mentioned
        if (a.compensation.mentioned && !b.compensation.mentioned) return -1;
        if (!a.compensation.mentioned && b.compensation.mentioned) return 1;

        // Then by estimated pay amount
        if (a.compensation.estimatedPay && b.compensation.estimatedPay) {
          return b.compensation.estimatedPay - a.compensation.estimatedPay;
        }
        if (a.compensation.estimatedPay) return -1;
        if (b.compensation.estimatedPay) return 1;

        return 0;
      });

      setTrials(parsedTrials);
    } catch (error) {
      console.error('Error fetching trials:', error);
      setTrials([]);
    }

    setLoading(false);
  };

  // Search on initial load
  useEffect(() => {
    searchTrials();
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-b from-emerald-50 to-white">
      {/* Header */}
      <header className="bg-emerald-600 text-white">
        <div className="max-w-6xl mx-auto px-4 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center text-2xl">
                💰
              </div>
              <div>
                <h1 className="text-xl font-bold">PaidTrials</h1>
                <p className="text-emerald-100 text-sm">Get paid to participate in research</p>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <div className="bg-emerald-600 text-white pb-12 pt-6">
        <div className="max-w-6xl mx-auto px-4">
          <div className="text-center mb-8">
            <h2 className="text-3xl md:text-4xl font-bold mb-3">
              Earn Money Participating in Research Studies
            </h2>
            <p className="text-emerald-100 text-lg max-w-2xl mx-auto">
              Find clinical trials and research studies that pay. Many studies offer $50-$500+ for your time.
            </p>
          </div>

          {/* Search Bar */}
          <div className="max-w-2xl mx-auto">
            <div className="bg-white rounded-2xl p-2 shadow-xl">
              <div className="flex gap-2">
                <div className="flex-1 relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400">📍</span>
                  <input
                    type="text"
                    placeholder="Enter your city or zip code"
                    value={filters.location}
                    onChange={(e) => setFilters({ ...filters, location: e.target.value })}
                    className="w-full pl-12 pr-4 py-4 rounded-xl text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    onKeyDown={(e) => e.key === 'Enter' && searchTrials()}
                  />
                </div>
                <button
                  onClick={searchTrials}
                  disabled={loading}
                  className="px-8 py-4 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-xl transition-colors disabled:opacity-50"
                >
                  {loading ? 'Searching...' : 'Find Studies'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Filters Bar */}
      <div className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-3">
          <div className="flex items-center gap-4 overflow-x-auto pb-2">
            {/* Study Type Pills */}
            {studyTypes.map(type => (
              <button
                key={type.id}
                onClick={() => {
                  setFilters({ ...filters, studyType: type.id });
                  setTimeout(searchTrials, 100);
                }}
                className={`flex items-center gap-2 px-4 py-2 rounded-full whitespace-nowrap transition-colors ${
                  filters.studyType === type.id
                    ? 'bg-emerald-600 text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                <span>{type.icon}</span>
                <span className="text-sm font-medium">{type.label}</span>
              </button>
            ))}

            {/* More Filters Button */}
            <button
              onClick={() => setShowFilters(!showFilters)}
              className="flex items-center gap-2 px-4 py-2 rounded-full bg-slate-100 text-slate-700 hover:bg-slate-200 whitespace-nowrap"
            >
              <span>⚙️</span>
              <span className="text-sm font-medium">Filters</span>
            </button>
          </div>

          {/* Expanded Filters */}
          {showFilters && (
            <div className="flex flex-wrap gap-4 pt-3 pb-2 border-t border-slate-100 mt-2">
              <div>
                <label className="block text-xs text-slate-500 mb-1">Age Range</label>
                <select
                  value={filters.ageRange}
                  onChange={(e) => setFilters({ ...filters, ageRange: e.target.value })}
                  className="px-3 py-2 rounded-lg border border-slate-200 text-sm"
                >
                  <option value="all">Any Age</option>
                  <option value="18-30">18-30</option>
                  <option value="31-50">31-50</option>
                  <option value="51-65">51-65</option>
                  <option value="65+">65+</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Sex</label>
                <select
                  value={filters.sex}
                  onChange={(e) => setFilters({ ...filters, sex: e.target.value })}
                  className="px-3 py-2 rounded-lg border border-slate-200 text-sm"
                >
                  <option value="all">Any</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                </select>
              </div>
              <button
                onClick={searchTrials}
                className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium self-end"
              >
                Apply Filters
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Results */}
      <div className="max-w-6xl mx-auto px-4 py-8">
        {loading ? (
          <div className="text-center py-16">
            <div className="w-16 h-16 border-4 border-emerald-200 border-t-emerald-600 rounded-full animate-spin mx-auto mb-4"></div>
            <p className="text-slate-600">Finding paid studies near you...</p>
          </div>
        ) : trials.length === 0 && searched ? (
          <div className="text-center py-16">
            <div className="text-6xl mb-4">🔍</div>
            <h3 className="text-xl font-semibold text-slate-800 mb-2">No studies found</h3>
            <p className="text-slate-600">Try adjusting your filters or searching a different location</p>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-semibold text-slate-800">
                {trials.length} Paid Studies Found
              </h3>
              <p className="text-sm text-slate-500">
                Sorted by likelihood of compensation
              </p>
            </div>

            <div className="grid gap-4">
              {trials.map(trial => (
                <TrialCard key={trial.id} trial={trial} />
              ))}
            </div>
          </>
        )}
      </div>

      {/* Footer */}
      <footer className="bg-slate-800 text-slate-300 py-8 mt-12">
        <div className="max-w-6xl mx-auto px-4 text-center">
          <p className="text-sm">
            Data sourced from ClinicalTrials.gov. Always verify compensation details directly with the study coordinator.
          </p>
        </div>
      </footer>
    </div>
  );
}

// Trial Card Component
function TrialCard({ trial }) {
  const [expanded, setExpanded] = useState(false);

  const getPaymentBadge = () => {
    if (trial.compensation.estimatedPay) {
      return (
        <span className="px-3 py-1 bg-green-100 text-green-700 rounded-full text-sm font-semibold flex items-center gap-1">
          💰 Up to ${trial.compensation.estimatedPay.toLocaleString()}
        </span>
      );
    }
    if (trial.compensation.mentioned) {
      return (
        <span className="px-3 py-1 bg-green-100 text-green-700 rounded-full text-sm font-medium flex items-center gap-1">
          💵 Compensation offered
        </span>
      );
    }
    if (trial.healthyVolunteers) {
      return (
        <span className="px-3 py-1 bg-emerald-100 text-emerald-700 rounded-full text-sm font-medium flex items-center gap-1">
          💪 Healthy volunteers - likely paid
        </span>
      );
    }
    return null;
  };

  const getStudyTypeBadge = () => {
    const type = trial.interventionType?.toLowerCase() || '';
    if (type.includes('drug')) return { label: 'Drug Study', color: 'bg-blue-100 text-blue-700' };
    if (type.includes('device')) return { label: 'Device Study', color: 'bg-purple-100 text-purple-700' };
    if (type.includes('biological')) return { label: 'Biological', color: 'bg-pink-100 text-pink-700' };
    if (type.includes('behavioral')) return { label: 'Behavioral', color: 'bg-orange-100 text-orange-700' };
    return { label: 'Research Study', color: 'bg-slate-100 text-slate-700' };
  };

  const studyType = getStudyTypeBadge();
  const location = trial.locations[0];

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden hover:shadow-lg transition-shadow">
      <div className="p-5">
        {/* Top Row - Badges */}
        <div className="flex flex-wrap items-center gap-2 mb-3">
          {getPaymentBadge()}
          <span className={`px-2 py-1 rounded text-xs font-medium ${studyType.color}`}>
            {studyType.label}
          </span>
          {trial.phase && trial.phase !== 'Not specified' && (
            <span className="px-2 py-1 bg-slate-100 text-slate-600 rounded text-xs">
              {trial.phase}
            </span>
          )}
        </div>

        {/* Title */}
        <h3 className="font-semibold text-slate-800 text-lg mb-2 leading-snug">
          {trial.title}
        </h3>

        {/* Quick Info */}
        <div className="flex flex-wrap gap-4 text-sm text-slate-600 mb-3">
          {location && (
            <span className="flex items-center gap-1">
              📍 {location.city}{location.state ? `, ${location.state}` : ''}
            </span>
          )}
          <span className="flex items-center gap-1">
            🏢 {trial.sponsor}
          </span>
          {trial.enrollment && (
            <span className="flex items-center gap-1">
              👥 {trial.enrollment} participants needed
            </span>
          )}
        </div>

        {/* Conditions */}
        {trial.conditions.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-3">
            {trial.conditions.slice(0, 3).map((condition, i) => (
              <span key={i} className="px-2 py-0.5 bg-slate-50 text-slate-600 rounded text-xs">
                {condition}
              </span>
            ))}
          </div>
        )}

        {/* Description Preview */}
        <p className={`text-slate-600 text-sm ${expanded ? '' : 'line-clamp-2'}`}>
          {trial.description}
        </p>

        {/* Expanded Details */}
        {expanded && (
          <div className="mt-4 pt-4 border-t border-slate-100">
            {/* Eligibility */}
            <div className="mb-4">
              <h4 className="font-medium text-slate-700 mb-2">Who Can Join</h4>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <div className="bg-slate-50 rounded-lg p-3">
                  <div className="text-slate-500 text-xs">Age</div>
                  <div className="font-medium">{trial.eligibility.minAge} - {trial.eligibility.maxAge}</div>
                </div>
                <div className="bg-slate-50 rounded-lg p-3">
                  <div className="text-slate-500 text-xs">Sex</div>
                  <div className="font-medium">{trial.eligibility.sex}</div>
                </div>
                <div className="bg-slate-50 rounded-lg p-3">
                  <div className="text-slate-500 text-xs">Healthy Volunteers</div>
                  <div className="font-medium">{trial.healthyVolunteers ? '✅ Yes' : '❌ No'}</div>
                </div>
                <div className="bg-slate-50 rounded-lg p-3">
                  <div className="text-slate-500 text-xs">Status</div>
                  <div className="font-medium text-green-600">{trial.status}</div>
                </div>
              </div>
            </div>

            {/* Contact Info */}
            {trial.contact && (
              <div className="mb-4">
                <h4 className="font-medium text-slate-700 mb-2">Contact</h4>
                <div className="bg-emerald-50 rounded-lg p-4">
                  {trial.contact.name && <p className="font-medium text-slate-800">{trial.contact.name}</p>}
                  <div className="flex flex-wrap gap-4 mt-2">
                    {trial.contact.email && (
                      <a href={`mailto:${trial.contact.email}`} className="text-emerald-600 hover:text-emerald-700 text-sm flex items-center gap-1">
                        ✉️ {trial.contact.email}
                      </a>
                    )}
                    {trial.contact.phone && (
                      <a href={`tel:${trial.contact.phone}`} className="text-emerald-600 hover:text-emerald-700 text-sm flex items-center gap-1">
                        📞 {trial.contact.phone}
                      </a>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Locations */}
            {trial.locations.length > 0 && (
              <div>
                <h4 className="font-medium text-slate-700 mb-2">Locations ({trial.locations.length})</h4>
                <div className="space-y-2">
                  {trial.locations.map((loc, i) => (
                    <div key={i} className="text-sm text-slate-600">
                      📍 {loc.facility} - {loc.city}, {loc.state} {loc.country}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-3 mt-4 pt-4 border-t border-slate-100">
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-sm text-emerald-600 hover:text-emerald-700 font-medium"
          >
            {expanded ? 'Show Less' : 'Show More Details'}
          </button>
          <a
            href={`https://clinicaltrials.gov/study/${trial.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-slate-500 hover:text-slate-700"
          >
            View on ClinicalTrials.gov →
          </a>
          <span className="text-xs text-slate-400 ml-auto">{trial.id}</span>
        </div>
      </div>
    </div>
  );
}

export default App
