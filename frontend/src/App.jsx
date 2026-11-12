import { useEffect, useState } from 'react';
import { Routes, Route, Link } from 'react-router-dom';
import { PawPrint, MapPin, Instagram, ArrowRight, Menu, X, CheckCircle } from 'lucide-react';
import { api } from './api';
import AdminDashboard from './AdminDashboard.jsx';
import ServiceCard from './ServiceCard.jsx';
import BookingPage from './BookingPage.jsx';
import { ForgotPassword, VerifyAdminOtp, ResetAdminPassword, PasswordResetSuccess } from './AdminRecovery.jsx';
import { ContactNumbersProvider, ContactOptions, FloatingContactWidget } from './contactOptions.jsx';

const money = n => `₹${Number(n || 0).toLocaleString('en-IN')}`;
const businessAddress = '1st Cross, Khata No 2789 Railway Gate South Regulatry Market Back Site, Medhehalli Rd, Chitradurga, Karnataka 577502';
const mapSearchUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(businessAddress)}`;

function Header() {
  const [open, setOpen] = useState(false);

  return (
    <header className="header">
      <Link to="/" className="brand">
        <span className="brand-icon"><PawPrint /></span>
        <span>A1 PAWS<small>Centre of Excellence in Grooming</small></span>
      </Link>
      <button className="mobile-toggle" onClick={() => setOpen(!open)} aria-label={open ? 'Close menu' : 'Open menu'}>
        {open ? <X /> : <Menu />}
      </button>
      <nav className={open ? 'nav open' : 'nav'}>
        <a href="/#services" onClick={() => setOpen(false)}>Services</a>
        <a href="/#about" onClick={() => setOpen(false)}>About</a>
        <a href="/#contact" onClick={() => setOpen(false)}>Contact</a>
        <details className="header-contact">
          <summary>Call / WhatsApp</summary>
          <ContactOptions variant="header" />
        </details>
        <Link className="btn small" to="/book" onClick={() => setOpen(false)}>
          Book appointment <ArrowRight size={16} />
        </Link>
      </nav>
    </header>
  );
}

function Home() {
  const [services, setServices] = useState([]);
  const [servicesLoading, setServicesLoading] = useState(true);
  const [servicesError, setServicesError] = useState('');
  const [servicesRetry, setServicesRetry] = useState(0);

  useEffect(() => {
    let active = true;
    setServicesLoading(true);
    api('/services')
      .then(rows => {
        if (active) {
          setServices(rows);
          setServicesError('');
        }
      })
      .catch(requestError => {
        if (active) setServicesError(requestError.message || 'Grooming services could not be loaded.');
      })
      .finally(() => {
        if (active) setServicesLoading(false);
      });
    return () => {
      active = false;
    };
  }, [servicesRetry]);

  return (
    <>
      <section className="hero">
        <div className="hero-copy">
          <span className="eyebrow"><PawPrint size={15} /> A little more love in every visit</span>
          <h1>Where every paw gets <em>premium care.</em></h1>
          <p>Thoughtful grooming, gentle handling and a happier, fresher best friend. Give your pet the care they deserve at A1 Paws.</p>
          <div className="hero-actions">
            <Link className="btn" to="/book">Book an appointment <ArrowRight size={17} /></Link>
            <a className="btn outline" href="#services">Explore services</a>
          </div>
          <div className="trust"><span>♥ Gentle care</span><span>✦ Clean & comfortable</span><span>🐾 Dogs & cats</span></div>
        </div>
        <div className="hero-photo">
          <img src="https://images.unsplash.com/photo-1516734212186-a967f81ad0d7?auto=format&fit=crop&w=1100&q=85" alt="A freshly groomed happy dog" />
          <div className="photo-note"><PawPrint /><span><b>Every pet is special</b><small>Care made personal</small></span></div>
        </div>
      </section>

      <section className="stats">
        <div><b>01</b><span>Gentle grooming</span></div>
        <div><b>02</b><span>Pet-first approach</span></div>
        <div><b>03</b><span>Fresh, happy paws</span></div>
      </section>

      <section className="section" id="services">
        <div className="section-head">
          <span className="eyebrow">OUR GROOMING MENU</span>
          <h2>Care for every coat.</h2>
          <p>Choose the services your furry friend needs. Prices and timings can be confirmed with our team.</p>
        </div>
        {servicesError ? (
          <div className="error" role="alert">
            <p>{servicesError}</p>
            <button className="text-link" onClick={() => setServicesRetry(retry => retry + 1)}>Retry loading services</button>
          </div>
        ) : servicesLoading ? (
          <p role="status">Loading grooming services…</p>
        ) : services.length ? (
          <div className="service-grid">
            {services.map((service, index) => <ServiceCard key={service.id} service={service} index={index} money={money} />)}
          </div>
        ) : (
          <p role="status">No grooming services are currently available.</p>
        )}
        <div className="center"><Link className="btn" to="/book">Choose services <ArrowRight size={17} /></Link></div>
      </section>

      <section className="about section" id="about">
        <div className="about-image">
          <img src="https://images.unsplash.com/photo-1516734212186-a967f81ad0d7?auto=format&fit=crop&w=900&q=85" alt="Dog receiving grooming care" />
        </div>
        <div>
          <span className="eyebrow">WELCOME TO A1 PAWS</span>
          <h2>More than grooming.<br /><em>It's care.</em></h2>
          <p>At A1 Paws, we believe grooming should be a calm, positive experience. Our focus is on cleanliness, gentle handling and helping every pet feel comfortable.</p>
          <ul className="checks">
            <li><CheckCircle /> Hygiene-focused care</li>
            <li><CheckCircle /> Gentle grooming practices</li>
            <li><CheckCircle /> Dog- and cat-friendly services</li>
            <li><CheckCircle /> Personal attention for every pet</li>
          </ul>
          <Link className="text-link" to="/book">Plan your pet's visit <ArrowRight size={16} /></Link>
        </div>
      </section>

      <section className="contact section" id="contact">
        <div>
          <span className="eyebrow">COME SAY HELLO</span>
          <h2>We can't wait to meet your <em>best friend.</em></h2>
          <p><MapPin /> {businessAddress}</p>
          <ContactOptions />
          <p><Instagram /> <a href="https://instagram.com/A1.PAWS" target="_blank" rel="noreferrer">@A1.PAWS</a></p>
          <Link className="btn" to="/book">Book your visit</Link>
        </div>
        <div className="map-placeholder">
          <MapPin size={34} />
          <b>A1 Paws</b>
          <span>Medhehalli Rd, Chitradurga</span>
          <a target="_blank" rel="noreferrer" href={mapSearchUrl}>
            Open in Google Maps ↗
          </a>
        </div>
      </section>

      <footer>
        <Link to="/" className="brand">
          <span className="brand-icon"><PawPrint /></span>
          <span>A1 PAWS<small>Centre of Excellence in Grooming</small></span>
        </Link>
        <ContactOptions variant="footer" />
        <span>© {new Date().getFullYear()} A1 Paws. Made with care.</span>
        <Link to="/admin">Admin</Link>
      </footer>
    </>
  );
}

export default function App() {
  return (
    <>
      <ContactNumbersProvider>
        <Header />
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/book" element={<BookingPage />} />
          <Route path="/admin" element={<AdminDashboard />} />
          <Route path="/admin/forgot-password" element={<ForgotPassword />} />
          <Route path="/admin/verify-otp" element={<VerifyAdminOtp />} />
          <Route path="/admin/reset-password" element={<ResetAdminPassword />} />
          <Route path="/admin/password-reset-success" element={<PasswordResetSuccess />} />
          <Route path="*" element={<Home />} />
        </Routes>
        <FloatingContactWidget />
      </ContactNumbersProvider>
    </>
  );
}
