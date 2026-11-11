import { Link } from 'react-router-dom';
import { ArrowRight, Bath, Clock3, Droplets, PawPrint, Scissors, Sparkles, Wind } from 'lucide-react';
import './service-card.css';

const serviceCardData = [
  {
    name: 'Bathing',
    imageUrl: '/images/services/bathing.jpg',
    imageAlt: 'A golden retriever being washed in a grooming tub.',
    Icon: Bath
  },
  {
    name: 'Towel Dry',
    imageUrl: '/images/services/towel-dry.jpg',
    imageAlt: 'A groomer drying a wet dog with a towel.',
    Icon: Droplets
  },
  {
    name: 'Blow Dry',
    imageUrl: '/images/services/blow-dry.jpg',
    imageAlt: 'A groomer blow-drying a dog’s coat in a salon.',
    Icon: Wind
  },
  {
    name: 'Basic Trim',
    imageUrl: '/images/services/basic-trim.jpg',
    imageAlt: 'A groomer working on a curly white dog’s coat.',
    Icon: Scissors
  },
  {
    name: 'Zero Trim',
    imageUrl: '/images/services/zero-trim.jpg',
    imageAlt: 'A groomer using clippers on a dog’s coat.',
    Icon: Sparkles
  },
  {
    name: 'Full Body Trim',
    imageUrl: '/images/services/full-body-trim.jpg',
    imageAlt: 'A groomer finishing a curly dog’s full coat with a dryer.',
    Icon: PawPrint
  }
];

export default function ServiceCard({ service, index, money }) {
  const visual = serviceCardData.find(item => item.name === service.name)
    ?? serviceCardData[index % serviceCardData.length];
  const Icon = visual.Icon;

  return (
    <article className="service-card">
      <div className="service-photo-wrap">
        <img
          className="service-image"
          src={visual.imageUrl}
          alt={visual.imageAlt}
          loading="lazy"
          decoding="async"
        />
        <span className="service-number">{String(index + 1).padStart(2, '0')}</span>
        <span className="service-icon-badge" aria-hidden="true"><Icon size={22}/></span>
      </div>
      <div className="service-content">
        <div className="service-copy">
          <div>
            <h3>{service.name}</h3>
            <p>{service.description}</p>
          </div>
          <PawPrint className="service-paw" size={25} aria-hidden="true"/>
        </div>
        <div className="service-meta">
          <b>{money(service.price)}</b>
          <span><Clock3 size={14} aria-hidden="true"/>{service.duration} min</span>
        </div>
        <Link className="service-book-button" to="/book">
          Book Now <ArrowRight size={15} aria-hidden="true"/>
        </Link>
      </div>
    </article>
  );
}
