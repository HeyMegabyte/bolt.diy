import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FeatureQuotes } from './feature-quotes';

describe('FeatureQuotes', () => {
  let component: FeatureQuotes;
  let fixture: ComponentFixture<FeatureQuotes>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FeatureQuotes],
    }).compileComponents();

    fixture = TestBed.createComponent(FeatureQuotes);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
