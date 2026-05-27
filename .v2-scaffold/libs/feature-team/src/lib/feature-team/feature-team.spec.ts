import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FeatureTeam } from './feature-team';

describe('FeatureTeam', () => {
  let component: FeatureTeam;
  let fixture: ComponentFixture<FeatureTeam>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FeatureTeam],
    }).compileComponents();

    fixture = TestBed.createComponent(FeatureTeam);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
