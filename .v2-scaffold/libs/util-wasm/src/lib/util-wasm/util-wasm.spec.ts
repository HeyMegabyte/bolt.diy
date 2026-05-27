import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UtilWasm } from './util-wasm';

describe('UtilWasm', () => {
  let component: UtilWasm;
  let fixture: ComponentFixture<UtilWasm>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [UtilWasm],
    }).compileComponents();

    fixture = TestBed.createComponent(UtilWasm);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
