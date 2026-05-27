import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FeatureBookings } from './feature-bookings';

describe('FeatureBookings', () => {
  let component: FeatureBookings;
  let fixture: ComponentFixture<FeatureBookings>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FeatureBookings],
    }).compileComponents();

    fixture = TestBed.createComponent(FeatureBookings);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
