import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x111111);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 1.5, 4);

const clipPlaneX = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 2.0);
const clipPlaneY = new THREE.Plane(new THREE.Vector3(0, -1, 0), 2.0);
const clipPlaneZ = new THREE.Plane(new THREE.Vector3(0, 0, -1), 2.0);
const activeClippingPlanes = [clipPlaneX, clipPlaneY, clipPlaneZ];

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.localClippingEnabled = true;
document.body.appendChild(renderer.domElement);

const labelRenderer = new CSS2DRenderer();
labelRenderer.setSize(window.innerWidth, window.innerHeight);
labelRenderer.domElement.style.position = 'absolute';
labelRenderer.domElement.style.top = '0px';
labelRenderer.domElement.style.pointerEvents = 'none';
document.body.appendChild(labelRenderer.domElement);

const ambientLight = new THREE.AmbientLight(0xffffff, 1.2);
scene.add(ambientLight);

const directionalLight = new THREE.DirectionalLight(0xffffff, 2.0);
directionalLight.position.set(5, 10, 7);
scene.add(directionalLight);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.minDistance = 0.5;
controls.maxDistance = 15.0;

let loadedModel = null;
let baseColorHex = "#d9776c";
let meshList = [];
let isPulsing = false;
let labelsVisible = true;
let rulerMode = false;

let rulerPointA = null;
let rulerPointB = null;
let rulerLine = null;
let rulerMarkerA = null;
let rulerMarkerB = null;

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let selectedMesh = null;
let originalMaterial = null;

let targetCameraPos = null;
let targetControlTarget = null;

const clinicalDatabase = {
    "Left Lobe Segment": {
        function: "Primary parenchymal division responsible for metabolic processing, vascular filtration, and structural lobe volume.",
        pathology: "Susceptible to focal parenchymal lesions, lobar hypertrophy, and localized ischemic infarcts."
    },
    "Right Lobe Segment": {
        function: "Major lateral parenchymal lobe mediating systemic perfusion, fluid homeostasis, and biochemical synthesis.",
        pathology: "Common site for nodular hyperplasia, cystic degeneration, and vascular congestion."
    },
    "Vascular Trunk": {
        function: "Central hemodynamic conduit transporting oxygenated blood and critical nutrients to the superior parenchymal lobes.",
        pathology: "Prone to atherosclerotic stenosis, aneurysmal dilation, and thromboembolic occlusion."
    }
};

const menuToggle = document.getElementById('menu-toggle');
const controlPanel = document.getElementById('control-panel');
const isolateBtn = document.getElementById('isolateBtn');
const hideBtn = document.getElementById('hideBtn');
const resetViewBtn = document.getElementById('resetViewBtn');
const snapshotBtn = document.getElementById('snapshotBtn');
const structureTree = document.getElementById('structureTree');
const pulseToggle = document.getElementById('pulseToggle');
const speakBtn = document.getElementById('speakBtn');
const pathologyBox = document.getElementById('pathologyBox');
const pathologyText = document.getElementById('pathologyText');
const functionLabel = document.getElementById('functionLabel');
const modelUpload = document.getElementById('modelUpload');
const modelStatus = document.getElementById('modelStatus');
const labelToggle = document.getElementById('labelToggle');
const rulerToggle = document.getElementById('rulerToggle');

if (menuToggle && controlPanel) {
    menuToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        controlPanel.classList.toggle('open');
    });

    renderer.domElement.addEventListener('click', () => {
        controlPanel.classList.remove('open');
    });
}

// Label Visibility Toggle
labelToggle.addEventListener('click', () => {
    labelsVisible = !labelsVisible;
    labelToggle.classList.toggle('active-mode', !labelsVisible);
    labelToggle.innerText = labelsVisible ? '🏷️ Hide Labels' : '🏷️ Show Labels';
    if (loadedModel) {
        loadedModel.traverse((child) => {
            child.children.forEach(c => {
                if (c.isCSS2DObject) c.visible = labelsVisible;
            });
        });
    }
});

// Ruler Tool Toggle
rulerToggle.addEventListener('click', () => {
    rulerMode = !rulerMode;
    rulerToggle.classList.toggle('active-mode', rulerMode);
    rulerToggle.innerText = rulerMode ? '📏 Active (Tap 2 pts)' : '📏 Ruler Tool';
    if (!rulerMode) clearRulerMeasurements();
});

function clearRulerMeasurements() {
    rulerPointA = null;
    rulerPointB = null;
    if (rulerLine) { scene.remove(rulerLine); rulerLine = null; }
    if (rulerMarkerA) { scene.remove(rulerMarkerA); rulerMarkerA = null; }
    if (rulerMarkerB) { scene.remove(rulerMarkerB); rulerMarkerB = null; }
}

speakBtn.addEventListener('click', () => {
    if (!selectedMesh) return;
    const textToSpeak = selectedMesh.name || "Anatomical Segment";
    if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(textToSpeak);
        utterance.rate = 0.9;
        utterance.pitch = 1.0;
        window.speechSynthesis.speak(utterance);
    }
});

function populateStructureTree() {
    if (!structureTree) return;
    structureTree.innerHTML = '';

    meshList.forEach((mesh, index) => {
        const div = document.createElement('div');
        div.className = 'tree-item';
        div.innerHTML = `<span>🔹 ${mesh.name || 'Segment ' + (index + 1)}</span> <span style="font-size:10px; color:#888;">Select</span>`;
        div.addEventListener('click', () => {
            selectAndFocusMesh(mesh);
            controlPanel.classList.remove('open');
        });
        structureTree.appendChild(div);
    });
}

function clearCurrentModel() {
    clearRulerMeasurements();
    if (loadedModel) {
        loadedModel.traverse((child) => {
            const labels = child.children.filter(c => c.isCSS2DObject);
            labels.forEach(l => {
                if (l.element && l.element.parentNode) {
                    l.element.parentNode.removeChild(l.element);
                }
                child.remove(l);
            });
        });
        scene.remove(loadedModel);
        loadedModel = null;
    }
    meshList = [];
    selectedMesh = null;
    originalMaterial = null;
    clearSelectionUI();
}

function applyClippingAndAddLabels(object) {
    let partCounter = 1;
    object.traverse((child) => {
        if (child.isMesh && child.material) {
            if (!child.name || child.name.trim() === "") {
                child.name = `Anatomical Segment ${partCounter++}`;
            }
            child.material.transparent = true;
            child.material.clippingPlanes = activeClippingPlanes;
            child.material.clipShadows = true;
            child.material.side = THREE.DoubleSide;

            const div = document.createElement('div');
            div.className = 'annotation-label';
            div.textContent = child.name;
            
            const label = new CSS2DObject(div);
            const box = new THREE.Box3().setFromObject(child);
            const center = box.getCenter(new THREE.Vector3());
            label.position.set(0, box.max.y - center.y + 0.08, 0);
            
            child.add(label);
            meshList.push(child);
        }
    });
}

function normalizeAndMountModel(modelRoot, labelName = "Custom Model") {
    clearCurrentModel();
    loadedModel = modelRoot;

    const box = new THREE.Box3().setFromObject(loadedModel);
    const center = box.getCenter(new THREE.Vector3());
    loadedModel.position.sub(center);

    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    if (maxDim > 0) {
        loadedModel.scale.multiplyScalar(2.0 / maxDim);
    }

    const wrapper = new THREE.Group();
    wrapper.add(loadedModel);
    loadedModel = wrapper;

    applyClippingAndAddLabels(loadedModel);
    scene.add(loadedModel);
    populateStructureTree();
    modelStatus.innerText = `Loaded: ${labelName}`;
}

function createFallbackAnatomy() {
    clearCurrentModel();
    const group = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ 
        color: new THREE.Color(baseColorHex), 
        roughness: 0.3, 
        metalness: 0.1,
        transparent: true,
        opacity: 1.0,
        clippingPlanes: activeClippingPlanes,
        side: THREE.DoubleSide
    });

    const part1 = new THREE.Mesh(new THREE.SphereGeometry(0.75, 32, 32), mat.clone());
    part1.name = "Left Lobe Segment";
    part1.position.set(-0.45, 0.2, 0);
    group.add(part1);

    const part2 = new THREE.Mesh(new THREE.SphereGeometry(0.65, 32, 32), mat.clone());
    part2.name = "Right Lobe Segment";
    part2.position.set(0.45, 0.2, 0);
    group.add(part2);

    const part3 = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.25, 1.0, 32), mat.clone());
    part3.name = "Vascular Trunk";
    part3.position.set(0, -0.5, 0);
    group.add(part3);

    loadedModel = group;
    applyClippingAndAddLabels(loadedModel);
    scene.add(loadedModel);
    populateStructureTree();
    modelStatus.innerText = "Reference Organ Model";
}

const loader = new GLTFLoader();
loader.load('./models/sample_organ.glb', (gltf) => {
    normalizeAndMountModel(gltf.scene, "Sample Organ");
}, undefined, () => {
    createFallbackAnatomy();
});

if (modelUpload) {
    modelUpload.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        modelStatus.innerText = "Parsing 3D asset...";
        const objectURL = URL.createObjectURL(file);

        loader.load(objectURL, (gltf) => {
            normalizeAndMountModel(gltf.scene, file.name);
            URL.revokeObjectURL(objectURL);
            controlPanel.classList.remove('open');
        }, undefined, (err) => {
            console.error("Model load error:", err);
            alert("Could not parse 3D model. Please ensure it is a valid .glb or .gltf file.");
            modelStatus.innerText = "Load Failed";
        });
    });
}

function clearSelectionUI() {
    document.getElementById('selectedPartName').innerText = "Select a Structure";
    document.getElementById('selectedPartDesc').innerText = "Tap any anatomical segment to inspect clinical metadata & pathology notes.";
    functionLabel.style.display = 'none';
    pathologyBox.style.display = 'none';
    speakBtn.style.display = 'none';
    isolateBtn.style.display = 'none';
    hideBtn.style.display = 'none';
}

function selectAndFocusMesh(mesh) {
    if (selectedMesh && selectedMesh !== mesh) {
        selectedMesh.material = originalMaterial;
    }

    selectedMesh = mesh;
    originalMaterial = selectedMesh.material;

    const highlightMaterial = selectedMesh.material.clone();
    highlightMaterial.color.setHex(0x4da6ff);
    highlightMaterial.clippingPlanes = activeClippingPlanes;
    selectedMesh.material = highlightMaterial;

    const partName = selectedMesh.name || "Anatomical Structure Segment";
    document.getElementById('selectedPartName').innerText = partName;

    const clinicalInfo = clinicalDatabase[partName] || {
        function: `Specialized morphological tissue segment (${partName}) maintaining structural integrity and physiological homeostasis.`,
        pathology: "Evaluate for localized inflammation, structural hypertrophy, or vascular compromise."
    };

    functionLabel.style.display = 'block';
    document.getElementById('selectedPartDesc').innerText = clinicalInfo.function;
    
    pathologyText.innerText = clinicalInfo.pathology;
    pathologyBox.style.display = 'block';
    speakBtn.style.display = 'flex';
    
    isolateBtn.style.display = 'block';
    hideBtn.style.display = 'block';
}

isolateBtn.addEventListener('click', () => {
    if (!loadedModel || !selectedMesh) return;
    loadedModel.traverse((child) => {
        if (child.isMesh) {
            child.visible = (child === selectedMesh);
        }
    });
});

hideBtn.addEventListener('click', () => {
    if (!selectedMesh) return;
    selectedMesh.visible = false;
    selectedMesh.material = originalMaterial;
    selectedMesh = null;
    clearSelectionUI();
});

resetViewBtn.addEventListener('click', () => {
    if (!loadedModel) return;
    loadedModel.traverse((child) => {
        if (child.isMesh) {
            child.visible = true;
        }
    });
    if (selectedMesh) {
        selectedMesh.material = originalMaterial;
        selectedMesh = null;
    }
    clearSelectionUI();
});

snapshotBtn.addEventListener('click', () => {
    renderer.render(scene, camera);
    const dataURL = renderer.domElement.toDataURL('image/png');
    const link = document.createElement('a');
    link.download = 'clinical-anatomy-snapshot.png';
    link.href = dataURL;
    link.click();
});

pulseToggle.addEventListener('click', () => {
    isPulsing = !isPulsing;
    if (isPulsing) {
        pulseToggle.classList.add('active-pulse');
        pulseToggle.innerText = '⏹ Stop Physiological Rhythm';
    } else {
        pulseToggle.classList.remove('active-pulse');
        pulseToggle.innerText = '💓 Simulate Cardiac Rhythm';
        if (loadedModel) loadedModel.scale.set(1, 1, 1);
    }
});

document.getElementById('clipX').addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    clipPlaneX.constant = val;
    document.getElementById('valX').innerText = val.toFixed(2);
});

document.getElementById('clipY').addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    clipPlaneY.constant = val;
    document.getElementById('valY').innerText = val.toFixed(2);
});

document.getElementById('clipZ').addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    clipPlaneZ.constant = val;
    document.getElementById('valZ').innerText = val.toFixed(2);
});

document.getElementById('modeSolid').addEventListener('click', () => {
    if (!loadedModel) return;
    loadedModel.traverse((child) => {
        if (child.isMesh && child.material) {
            child.material.wireframe = false;
            child.material.opacity = 1.0;
            child.material.depthWrite = true;
        }
    });
    controlPanel.classList.remove('open');
});

document.getElementById('modeWireframe').addEventListener('click', () => {
    if (!loadedModel) return;
    loadedModel.traverse((child) => {
        if (child.isMesh && child.material) {
            child.material.wireframe = true;
            child.material.opacity = 1.0;
            child.material.depthWrite = true;
        }
    });
    controlPanel.classList.remove('open');
});

document.getElementById('modeXray').addEventListener('click', () => {
    if (!loadedModel) return;
    loadedModel.traverse((child) => {
        if (child.isMesh && child.material) {
            child.material.wireframe = false;
            child.material.opacity = 0.35;
            child.material.depthWrite = false;
        }
    });
    controlPanel.classList.remove('open');
});

function setCameraView(pos, target = new THREE.Vector3(0, 0, 0)) {
    targetCameraPos = pos;
    targetControlTarget = target;
    controlPanel.classList.remove('open');
}

document.getElementById('viewAnterior').addEventListener('click', () => setCameraView(new THREE.Vector3(0, 0, 3.5)));
document.getElementById('viewPosterior').addEventListener('click', () => setCameraView(new THREE.Vector3(0, 0, -3.5)));
document.getElementById('viewLateralL').addEventListener('click', () => setCameraView(new THREE.Vector3(-3.5, 0, 0)));
document.getElementById('viewLateralR').addEventListener('click', () => setCameraView(new THREE.Vector3(3.5, 0, 0)));
document.getElementById('viewSuperior').addEventListener('click', () => setCameraView(new THREE.Vector3(0, 3.5, 0.001)));

// Pointer / Click Handler for Selection & Ruler Measurement
window.addEventListener('pointerdown', (event) => {
    if (event.target.closest('#control-panel') || event.target.closest('#menu-toggle') || event.target.closest('#selection-box')) return;

    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);

    if (loadedModel) {
        const intersects = raycaster.intersectObject(loadedModel, true);
        if (intersects.length > 0) {
            const hitPoint = intersects[0].point;

            if (rulerMode) {
                // Ruler Measurement Logic
                const markerGeo = new THREE.SphereGeometry(0.04, 16, 16);
                const markerMat = new THREE.MeshBasicMaterial({ color: 0xffff00 });

                if (!rulerPointA) {
                    rulerPointA = hitPoint.clone();
                    rulerMarkerA = new THREE.Mesh(markerGeo, markerMat);
                    rulerMarkerA.position.copy(rulerPointA);
                    scene.add(rulerMarkerA);
                    document.getElementById('selectedPartName').innerText = "Ruler: Point A Set";
                    document.getElementById('selectedPartDesc').innerText = `Coordinates: X:${rulerPointA.x.toFixed(2)} Y:${rulerPointA.y.toFixed(2)} Z:${rulerPointA.z.toFixed(2)}. Tap Point B.`;
                } else if (!rulerPointB) {
                    rulerPointB = hitPoint.clone();
                    rulerMarkerB = new THREE.Mesh(markerGeo, markerMat);
                    rulerMarkerB.position.copy(rulerPointB);
                    scene.add(rulerMarkerB);

                    // Draw Line between A and B
                    const lineGeo = new THREE.BufferGeometry().setFromPoints([rulerPointA, rulerPointB]);
                    const lineMat = new THREE.LineBasicMaterial({ color: 0xffff00, linewidth: 2 });
                    rulerLine = new THREE.Line(lineGeo, lineMat);
                    scene.add(rulerLine);

                    const distance = rulerPointA.distanceTo(rulerPointB);
                    document.getElementById('selectedPartName').innerText = "Ruler Measurement";
                    document.getElementById('selectedPartDesc').innerText = `Spatial Distance: ${(distance * 10.0).toFixed(1)} mm (${distance.toFixed(2)} units).`;
                    
                    rulerPointA = null; // Reset for next measurement
                    rulerPointB = null;
                }
            } else {
                selectAndFocusMesh(intersects[0].object);
            }
        }
    }
});

const searchInput = document.getElementById('searchInput');
const searchResults = document.getElementById('searchResults');

if (searchInput) {
    searchInput.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase().trim();
        searchResults.innerHTML = '';
        
        if (query.length === 0) {
            searchResults.style.display = 'none';
            return;
        }

        const matches = meshList.filter(m => (m.name || "anatomical segment").toLowerCase().includes(query) && m.visible);
        
        if (matches.length > 0) {
            searchResults.style.display = 'block';
            matches.forEach(m => {
                const div = document.createElement('div');
                div.className = 'search-item';
                div.innerText = m.name || "Anatomical Segment";
                div.addEventListener('click', () => {
                    selectAndFocusMesh(m);
                    searchResults.style.display = 'none';
                    searchInput.value = m.name || "Anatomical Segment";
                    controlPanel.classList.remove('open');
                });
                searchResults.appendChild(div);
            });
        } else {
            searchResults.style.display = 'none';
        }
    });
}

document.getElementById('colorPicker').addEventListener('input', (e) => {
    baseColorHex = e.target.value;
    const selectedColor = new THREE.Color(baseColorHex);
    if (loadedModel) {
        loadedModel.traverse((child) => {
            if (child.isMesh && child.material && child !== selectedMesh) {
                child.material.color = selectedColor;
            }
        });
    }
});

document.getElementById('opacitySlider').addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    document.getElementById('opacityVal').innerText = val.toFixed(2);
    if (loadedModel) {
        loadedModel.traverse((child) => {
            if (child.isMesh && child.material) {
                child.material.opacity = val;
                child.material.depthWrite = val >= 1.0;
            }
        });
    }
});

document.getElementById('ambientSlider').addEventListener('input', (e) => {
    ambientLight.intensity = parseFloat(e.target.value);
});

document.getElementById('dirSlider').addEventListener('input', (e) => {
    directionalLight.intensity = parseFloat(e.target.value);
});

function animate() {
    requestAnimationFrame(animate);

    if (isPulsing && loadedModel) {
        const pulse = 1.0 + Math.sin(Date.now() * 0.006) * 0.04;
        loadedModel.scale.set(pulse, pulse, pulse);
    }

    if (targetCameraPos && targetControlTarget) {
        camera.position.lerp(targetCameraPos, 0.08);
        controls.target.lerp(targetControlTarget, 0.08);
        if (camera.position.distanceTo(targetCameraPos) < 0.01) {
            targetCameraPos = null;
            targetControlTarget = null;
        }
    }

    controls.update();
    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
}
animate();

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    labelRenderer.setSize(window.innerWidth, window.innerHeight);
});