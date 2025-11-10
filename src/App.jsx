import { useEffect, useMemo, useState } from 'react'

function Label({ children, htmlFor }) {
  return (
    <label htmlFor={htmlFor} className="block text-sm font-medium text-gray-700 mb-1">
      {children}
    </label>
  )
}

function Input(props) {
  return (
    <input
      {...props}
      className={`w-full border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${props.className || ''}`}
    />
  )
}

function Select({ children, ...props }) {
  return (
    <select
      {...props}
      className={`w-full border rounded-md px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 ${props.className || ''}`}
    >
      {children}
    </select>
  )
}

function Section({ title, children }) {
  return (
    <div className="bg-white/80 backdrop-blur p-5 rounded-xl shadow-sm">
      <h3 className="text-lg font-semibold text-gray-800 mb-4">{title}</h3>
      {children}
    </div>
  )
}

export default function App() {
  const baseUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000'
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [barbers, setBarbers] = useState([])
  const [services, setServices] = useState([])
  const [appointments, setAppointments] = useState([])

  const [availability, setAvailability] = useState({ checking: false, available: null, message: '' })

  const [form, setForm] = useState({
    customer_name: '',
    customer_phone: '',
    barber_id: '',
    service_name: '',
    start_date: '',
    start_time: '',
    notes: ''
  })

  const selectedService = useMemo(() => services.find(s => s.name === form.service_name), [services, form.service_name])
  const duration_min = selectedService?.duration_min || 30

  const fetchCatalog = async () => {
    try {
      const [bRes, sRes] = await Promise.all([
        fetch(`${baseUrl}/api/barbers`),
        fetch(`${baseUrl}/api/services`)
      ])
      const [bData, sData] = await Promise.all([bRes.json(), sRes.json()])

      // If a time is selected, auto-filter out barbers that are not available
      const filteredBarbers = await filterBarbersByAvailability(bData)
      setBarbers(filteredBarbers)

      setServices(sData.map(s => s.name === 'Haircut' ? { ...s, price: 18 } : s))

      if (!form.barber_id && filteredBarbers[0]?.id) {
        setForm(f => ({ ...f, barber_id: filteredBarbers[0].id }))
      }
      if (!form.service_name && sData[0]?.name) {
        setForm(f => ({ ...f, service_name: sData[0].name }))
      }
    } catch (e) {
      console.error(e)
      setError('Failed to load barbers/services')
    }
  }

  const fetchAppointments = async () => {
    try {
      const res = await fetch(`${baseUrl}/api/appointments`)
      const data = await res.json()
      setAppointments(data)
    } catch (e) {
      console.error(e)
    }
  }

  useEffect(() => {
    fetchCatalog()
    fetchAppointments()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleChange = (e) => {
    const { name, value } = e.target
    setForm(prev => ({ ...prev, [name]: value }))
  }

  const combineDateTime = (dateStr, timeStr) => {
    if (!dateStr || !timeStr) return null
    const [year, month, day] = dateStr.split('-').map(Number)
    const [hour, minute] = timeStr.split(':').map(Number)
    const dt = new Date(Date.UTC(year, month - 1, day, hour, minute, 0))
    return dt.toISOString()
  }

  // Availability check
  const checkAvailability = async () => {
    const startIso = combineDateTime(form.start_date, form.start_time)
    if (!form.barber_id || !startIso || !duration_min) {
      setAvailability({ checking: false, available: null, message: '' })
      return
    }
    try {
      setAvailability({ checking: true, available: null, message: '' })
      const params = new URLSearchParams({
        barber_id: form.barber_id,
        start_time: startIso,
        duration_min: String(duration_min)
      })
      const res = await fetch(`${baseUrl}/api/appointments/check?${params.toString()}`)
      if (!res.ok) throw new Error('Unable to check availability')
      const data = await res.json()
      setAvailability({ checking: false, available: !!data.available, message: data.available ? 'Time is available' : 'Time slot not available' })
    } catch (e) {
      setAvailability({ checking: false, available: null, message: 'Unable to check availability' })
    }
  }

  // Filter barbers dynamically based on selected date/time and service duration
  const filterBarbersByAvailability = async (allBarbers = barbers) => {
    const startIso = combineDateTime(form.start_date, form.start_time)
    if (!startIso || !duration_min) return allBarbers
    try {
      const checks = await Promise.all(allBarbers.map(async (b) => {
        const params = new URLSearchParams({
          barber_id: b.id,
          start_time: startIso,
          duration_min: String(duration_min)
        })
        const res = await fetch(`${baseUrl}/api/appointments/check?${params.toString()}`)
        if (!res.ok) return { barber: b, available: true }
        const data = await res.json()
        return { barber: b, available: !!data.available }
      }))
      const availableBarbers = checks.filter(c => c.available).map(c => c.barber)
      return availableBarbers
    } catch {
      return allBarbers
    }
  }

  // Trigger availability checks when inputs change
  useEffect(() => {
    checkAvailability()
    // Also refilter the barbers so the list only shows available ones for the chosen slot
    ;(async () => {
      const filtered = await filterBarbersByAvailability()
      setBarbers(filtered)
      // If current barber becomes unavailable, switch to first available (if any)
      if (form.barber_id && !filtered.find(b => b.id === form.barber_id)) {
        setForm(f => ({ ...f, barber_id: filtered[0]?.id || '' }))
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.service_name, form.start_date, form.start_time, duration_min])

  const submit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const startIso = combineDateTime(form.start_date, form.start_time)
      if (!startIso) {
        setError('Please select a date and time')
        setLoading(false)
        return
      }

      // Final availability check before booking
      const params = new URLSearchParams({
        barber_id: form.barber_id,
        start_time: startIso,
        duration_min: String(duration_min)
      })
      const chk = await fetch(`${baseUrl}/api/appointments/check?${params.toString()}`)
      if (!chk.ok) {
        throw new Error('Unable to verify availability')
      }
      const chkData = await chk.json()
      if (!chkData.available) {
        setError('That time was just taken. Please choose another slot.')
        setLoading(false)
        await fetchAppointments()
        return
      }

      const payload = {
        customer_name: form.customer_name,
        customer_phone: form.customer_phone,
        barber_id: form.barber_id,
        service_name: form.service_name,
        start_time: startIso,
        duration_min: duration_min,
        notes: form.notes || undefined
      }
      const res = await fetch(`${baseUrl}/api/appointments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Failed to book appointment' }))
        throw new Error(err.detail || 'Failed to book appointment')
      }
      await res.json()
      await fetchAppointments()
      setForm(f => ({ ...f, start_date: '', start_time: '', notes: '' }))
      setAvailability({ checking: false, available: null, message: '' })
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const cancel = async (id) => {
    try {
      const res = await fetch(`${baseUrl}/api/appointments/${id}/cancel`, { method: 'PATCH' })
      if (!res.ok) throw new Error('Failed to cancel appointment')
      await fetchAppointments()
    } catch (e) {
      setError(e.message)
    }
  }

  const fmt = (iso) => new Date(iso).toLocaleString()

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50">
      <header className="px-6 py-5 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-800">Barber Appointments</h1>
        <a href="/test" className="text-sm text-blue-600 hover:underline">Check connection</a>
      </header>

      <main className="max-w-6xl mx-auto px-6 pb-16 grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 space-y-6">
          <Section title="Book an appointment">
            <form onSubmit={submit} className="space-y-4">
              {error && (
                <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-2">{error}</div>
              )}

              <div>
                <Label htmlFor="customer_name">Your name</Label>
                <Input
                  id="customer_name"
                  name="customer_name"
                  required
                  placeholder="Alex Doe"
                  value={form.customer_name}
                  onChange={handleChange}
                />
              </div>

              <div>
                <Label htmlFor="customer_phone">Phone</Label>
                <Input
                  id="customer_phone"
                  name="customer_phone"
                  required
                  placeholder="(555) 123-4567"
                  value={form.customer_phone}
                  onChange={handleChange}
                />
              </div>

              <div>
                <Label htmlFor="barber_id">Choose barber</Label>
                <Select id="barber_id" name="barber_id" value={form.barber_id} onChange={handleChange}>
                  {barbers.map(b => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </Select>
                {combineDateTime(form.start_date, form.start_time) && (
                  <p className="text-xs text-gray-500 mt-1">Showing only available barbers for the selected time.</p>
                )}
              </div>

              <div>
                <Label htmlFor="service_name">Service</Label>
                <Select id="service_name" name="service_name" value={form.service_name} onChange={handleChange}>
                  {services.map(s => (
                    <option key={s.name} value={s.name}>{s.name} • ${s.price} • {s.duration_min}m</option>
                  ))}
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="start_date">Date</Label>
                  <Input id="start_date" name="start_date" type="date" value={form.start_date} onChange={handleChange} required />
                </div>
                <div>
                  <Label htmlFor="start_time">Time</Label>
                  <Input id="start_time" name="start_time" type="time" value={form.start_time} onChange={handleChange} required />
                </div>
              </div>

              {availability.message && (
                <div className={`text-xs rounded px-2 py-1 inline-block ${availability.available === true ? 'bg-green-50 text-green-700 border border-green-200' : availability.available === false ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-gray-50 text-gray-600 border border-gray-200'}`}>
                  {availability.checking ? 'Checking availability…' : availability.message}
                </div>
              )}

              <div>
                <Label htmlFor="notes">Notes (optional)</Label>
                <Input id="notes" name="notes" placeholder="Any preferences" value={form.notes} onChange={handleChange} />
              </div>

              <p className="text-xs text-gray-500">Duration: {duration_min} minutes</p>

              <button
                type="submit"
                disabled={loading || availability.available === false}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-md py-2 font-medium transition"
              >
                {loading ? 'Booking...' : 'Book Appointment'}
              </button>
            </form>
          </Section>

          <Section title="Our services">
            <ul className="divide-y">
              {services.map(s => (
                <li key={s.name} className="py-3 flex items-center justify-between text-sm">
                  <span className="text-gray-700">{s.name}</span>
                  <span className="text-gray-500">${s.price} • {s.duration_min}m</span>
                </li>
              ))}
              {services.length === 0 && (
                <p className="text-sm text-gray-500">No services yet</p>
              )}
            </ul>
          </Section>
        </div>

        <div className="lg:col-span-2 space-y-6">
          <Section title="Upcoming appointments">
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-600">
                    <th className="py-2 pr-4">Customer</th>
                    <th className="py-2 pr-4">Barber</th>
                    <th className="py-2 pr-4">Service</th>
                    <th className="py-2 pr-4">Start</th>
                    <th className="py-2 pr-4">End</th>
                    <th className="py-2 pr-4">Status</th>
                    <th className="py-2 pr-4"/>
                  </tr>
                </thead>
                <tbody>
                  {appointments.map(a => {
                    const barber = barbers.find(b => b.id === a.barber_id)
                    return (
                      <tr key={a.id} className="border-t">
                        <td className="py-2 pr-4">{a.customer_name}<div className="text-xs text-gray-500">{a.customer_phone}</div></td>
                        <td className="py-2 pr-4">{barber?.name || '—'}</td>
                        <td className="py-2 pr-4">{a.service_name}</td>
                        <td className="py-2 pr-4">{fmt(a.start_time)}</td>
                        <td className="py-2 pr-4">{fmt(a.end_time)}</td>
                        <td className="py-2 pr-4">
                          <span className={`px-2 py-0.5 rounded-full text-xs ${a.status === 'booked' ? 'bg-blue-100 text-blue-700' : a.status === 'canceled' ? 'bg-gray-100 text-gray-700' : 'bg-green-100 text-green-700'}`}>
                            {a.status}
                          </span>
                        </td>
                        <td className="py-2 pr-4 text-right">
                          {a.status === 'booked' && (
                            <button onClick={() => cancel(a.id)} className="text-red-600 hover:underline">Cancel</button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                  {appointments.length === 0 && (
                    <tr>
                      <td colSpan="7" className="py-6 text-center text-gray-500">No appointments yet</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="flex justify-end">
              <button onClick={fetchAppointments} className="text-sm text-blue-600 hover:underline">Refresh</button>
            </div>
          </Section>

          <Section title="Our barbers">
            <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-4">
              {barbers.map(b => (
                <div key={b.id} className={`border rounded-lg p-4 ${form.barber_id === b.id ? 'ring-2 ring-blue-500' : ''}`}>
                  <div className="h-10 w-10 rounded-full bg-gradient-to-br from-blue-400 to-purple-400 text-white flex items-center justify-center font-semibold">
                    {b.name?.[0] || '?'}
                  </div>
                  <div className="mt-3 font-medium text-gray-800">{b.name}</div>
                  <div className="text-xs text-gray-500">{b.bio || 'Professional barber'}</div>
                  <button
                    onClick={() => setForm(f => ({ ...f, barber_id: b.id }))}
                    className="mt-3 text-xs text-blue-600 hover:underline"
                  >
                    Select
                  </button>
                </div>
              ))}
              {barbers.length === 0 && (
                <p className="text-sm text-gray-500">No barbers available for the selected time</p>
              )}
            </div>
          </Section>
        </div>
      </main>
    </div>
  )
}
