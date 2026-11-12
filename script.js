import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x111111);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 1.5, 4);

const clipPlane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 2.0);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.localClippingEnabled = true;
document.body.appendChild(renderer.domElement);

// Initialize CSS2D Label Renderer
const labelRenderer = new CSS2DRenderer();
labelRenderer.setSize(window.innerWidth, window.innerHeight);
labelRenderer.domElement.style.position = 'absolute';
labelRenderer.domElement.style.top = '0px';
labelRenderer.domElement.style.pointerEvents = 'none'; // Allow click-through to canvas
document.body.appendChild(labelRenderer.domElement);

const ambientLight = new THREE.AmbientLight(0xffffff, 1.2);
scene.add(ambientLight);

const directionalLight = new THREE.DirectionalLight(0xffffff, 2.0);
directionalLight.position.set(5, 10, 7);
scene.add(directionalLight);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;

let loadedModel = null;
let baseColorHex = "#d9776c";
let meshList = [];

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let selectedMesh = null;
let originalMaterial = null;

let targetCameraPos = null;
let targetControlTarget = null;

const menuToggle = document.getElementById('menu-toggle');
const controlPanel = document.getElementById('control-panel');

if (menuToggle && controlPanel) {
    menuToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        controlPanel.classList.toggle('open');
    });

    renderer.domElement.addEventListener('click', () => {
        controlPanel.classList.remove('open');
    });
}

function applyClippingAndAddLabels(object) {
    object.traverse((child) => {
        if (child.isMesh && child.material) {
            child.material.clippingPlanes = [clipPlane];
            child.material.clipShadows = true;
            child.material.side = THREE.DoubleSide;

            // Create floating label element
            const div = document.createElement('div');
            div.className = 'annotation-label';
            div.textContent = child.name || "Segment";
            
            const label = new CSS2DObject(div);
            
            // Position label slightly above the mesh center
            const box = new THREE.Box3().setFromObject(child);
            const center = box.getCenter(new THREE.Vector3());
            label.position.set(0, box.max.y - center.y + 0.1, 0);
            
            child.add(label);
        }
    });
}

function createFallbackAnatomy() {
    const group = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ 
        color: new THREE.Color(baseColorHex), 
        roughness: 0.3, 
        metalness: 0.1,
        transparent: true,
        opacity: 1.0,
        clippingPlanes: [clipPlane],
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
    meshList = [];
    loadedModel.traverse((child) => {
        if (child.isMesh) meshList.push(child);
    });

    applyClippingAndAddLabels(loadedModel);
    scene.add(loadedModel);
}

const loader = new GLTFLoader();
loader.load('./models/sample_organ.glb', (gltf) => {
    loadedModel = gltf.scene;

    const box = new THREE.Box3().setFromObject(loadedModel);
    const center = box.getCenter(new THREE.Vector3());
    loadedModel.position.sub(center);

    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    loadedModel.scale.multiplyScalar(2.0 / maxDim);

    meshList = [];
    loadedModel.traverse((child) => {
        if (child.isMesh) {
            child.material.transparent = true;
            meshList.push(child);
        }
    });

    applyClippingAndAddLabels(loadedModel);
    scene.add(loadedModel);
}, undefined, () => {
    createFallbackAnatomy();
});

function selectAndFocusMesh(mesh) {
    if (selectedMesh && selectedMesh !== mesh) {
        selectedMesh.material = originalMaterial;
    }

    selectedMesh = mesh;
    originalMaterial = selectedMesh.material;

    const highlightMaterial = selectedMesh.material.clone();
    highlightMaterial.color.setHex(0x4da6ff);
    highlightMaterial.clippingPlanes = [clipPlane];
    selectedMesh.material = highlightMaterial;

    const partName = selectedMesh.name || "Anatomical Structure Segment";
    document.getElementById('selectedPartName').innerText = partName;
    document.getElementById('selectedPartDesc').innerText = "Clinical status: Active segment. Verified 3D morphological asset.";

    const meshBox = new THREE.Box3().setFromObject(selectedMesh);
    const meshCenter = meshBox.getCenter(new THREE.Vector3());
    
    targetControlTarget = meshCenter.clone();
    targetCameraPos = meshCenter.clone().add(new THREE.Vector3(0, 0.4, 1.8));
}

window.addEventListener('pointerdown', (event) => {
    if (event.target.closest('#control-panel') || event.target.closest('#menu-toggle') || event.target.closest('#selection-box')) return;

    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);

    if (loadedModel) {
        const intersects = raycaster.intersectObject(loadedModel, true);
        if (intersects.length > 0) {
            selectAndFocusMesh(intersects[0].object);
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

        const matches = meshList.filter(m => (m.name || "anatomical segment").toLowerCase().includes(query));
        
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

document.getElementById('clipSlider').addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    clipPlane.constant = val;
    document.getElementById('clipVal').innerText = val.toFixed(2);
});

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
    labelRenderer.render(scene, camera); // Render floating annotation tags
}
animate();

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    labelRenderer.setSize(window.innerWidth, window.innerHeight);
});