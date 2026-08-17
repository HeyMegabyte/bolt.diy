import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { PricingComponent } from './pricing.component';

/**
 * The pricing page is conversion-critical marketing prose. A raw template
 * placeholder like `{slug}` leaking into the copy reads as a broken/unrendered
 * variable to a prospective customer — "looks broken = is broken". This spec
 * locks the copy to a concrete illustrative subdomain instead.
 */
describe('PricingComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PricingComponent],
      providers: [provideRouter([])],
    }).compileComponents();
  });

  it('never leaks a literal {slug} placeholder in the pricing copy', () => {
    const fixture = TestBed.createComponent(PricingComponent);
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).not.toContain('{slug}');
    expect(text).toContain('yoursite.projectsites.dev');
  });
});
