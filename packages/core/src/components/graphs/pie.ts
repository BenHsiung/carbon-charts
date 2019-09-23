// Internal Imports
import { Component } from "../component";
import * as Configuration from "../../configuration";
import { DOMUtils } from "../../services";
import { Tools } from "../../tools";

// D3 Imports
import { select } from "d3-selection";
import { arc, pie } from "d3-shape";
import { interpolate } from "d3-interpolate";

// Pie slice tween function
function arcTween(a, arcFunc) {
	const i = interpolate(this._current, a);

	return t => {
		this._current = i(t);
		return arcFunc(this._current);
	};
}

export class Pie extends Component {
	type = "pie";

	// We need to store our arcs
	// So that addEventListeners()
	// Can access them
	arc: any;
	hoverArc: any;

	init() {
		const eventsFragment = this.services.events.getDocumentFragment();

		// Highlight correct circle on legend item hovers
		eventsFragment.addEventListener("legend-item-onhover", this.handleLegendOnHover);

		// Un-highlight circles on legend item mouseouts
		eventsFragment.addEventListener("legend-item-onmouseout", this.handleLegendMouseOut);
	}

	getDataList() {
		const displayData = this.model.getDisplayData();
		const dataset = displayData.datasets[0];
		return dataset.data.map((datum, i) => {
			return {
				label: displayData.labels[i],
				value: datum
			};
		});
	}

	getInnerRadius() {
		const options = this.model.getOptions();
		return options.pie.innerRadius;
	}

	render(animate = true) {
		const self = this;
		const svg = this.getContainerSVG();
		const options = this.model.getOptions();
		const dataList = this.getDataList();

		// Compute the outer radius needed
		const radius = this.computeRadius();

		this.arc = arc()
			.innerRadius(this.getInnerRadius())
			.outerRadius(radius);

		// Set the hover arc radius
		this.hoverArc = arc()
			.innerRadius(this.getInnerRadius())
			.outerRadius(radius + options.pie.hoverArc.outerRadiusOffset);

		// Setup the pie layout
		const pieLayout = pie()
			.value((d: any) => d.value)
			.sort(function(a: any, b: any) {
				return b.value - a.value;
			})
			.padAngle(options.pie.padAngle);

		// Update data on all slices
		const paths = svg.selectAll("path.slice")
			.data(pieLayout(dataList), d => d.data.label);

		// Remove slices that need to be exited
		paths.exit()
			.attr("opacity", 0)
			.remove();

		// Add new slices that are being introduced
		const enteringPaths = paths.enter()
			.append("path")
			.classed("slice", true)
			.attr("opacity", 0);

		// Update styles & position on existing and entering slices
		enteringPaths.merge(paths)
			.attr("fill", d => this.model.getFillScale()(d.data.label))
			.attr("d", this.arc)
			.transition(this.services.transitions.getTransition("pie-slice-enter-update", animate))
			.attr("opacity", 1)
			.attrTween("d", function (a) {
				return arcTween.bind(this)(a, self.arc);
			});

		// Draw the slice labels
		const labels = svg.selectAll("text.chart-label")
			.data(pieLayout(dataList), (d: any) => d.data.label);

		// Remove labels that are existing
		labels.exit()
			.attr("opacity", 0)
			.remove();

		// Add labels that are being introduced
		const enteringLabels = labels.enter()
			.append("text")
			.classed("chart-label", true);

		// Update styles & position on existing & entering labels
		enteringLabels.merge(labels)
			.style("text-anchor", "middle")
			.text(d => self.getSliceLabelText(d.data.value, dataList))
			.attr("transform", function (d) { return self.getChartLabelTranslateString(this, d, radius, dataList.length); });

		// Position Pie
		svg.attr("transform", `translate(${radius + options.pie.xOffset}, ${radius + options.pie.yOffset})`);

		// Add event listeners
		this.addEventListeners();
	}

	// Highlight elements that match the hovered legend item
	handleLegendOnHover = e => {
		const { hoveredElement } = e.detail;

		this.parent.selectAll("path.slice")
			.transition(this.services.transitions.getTransition("legend-hover-bar"))
			.attr("opacity", d => {
				if (d.data.label !== hoveredElement.datum()["key"]) {
					return 0.3;
				}

				return 1;
			});
	}

	// Un-highlight all elements
	handleLegendMouseOut = e => {
		this.parent.selectAll("path.slice")
			.transition(this.services.transitions.getTransition("legend-mouseout-bar"))
			.attr("opacity", 1);
	}

	addEventListeners() {
		const self = this;
		this.parent.selectAll("path.slice")
			.on("mouseover", function() {
				const hoveredElement = select(this);

				hoveredElement.classed("hovered", true)
					.transition(self.services.transitions.getTransition("pie_slice_hover"))
					.attr("d", self.hoverArc);

				// Dispatch mouse event
				self.services.events.dispatchEvent("pie-slice-mouseover", hoveredElement);

				// Show tooltip
				self.services.events.dispatchEvent("show-tooltip", {
					hoveredElement
				});
			})
			.on("mouseout", function() {
				const hoveredElement = select(this);
				hoveredElement.classed("hovered", false)
					.transition(self.services.transitions.getTransition("pie_slice_hover"))
					.attr("d", self.arc);

				// Dispatch mouse event
				self.services.events.dispatchEvent("pie-slice-mouseout", hoveredElement);

				// Hide tooltip
				self.services.events.dispatchEvent("hide-tooltip", {
					hoveredElement
				});
			})
			.on("click", d => self.services.events.dispatchEvent("pie-slice-click", d));
	}

	// Helper functions
	protected computeRadius() {
		const options = this.model.getOptions();

		const { width, height } = DOMUtils.getSVGElementSize(this.parent, { useAttrs: true });
		const radius: number = Math.min(width, height) / 2;

		return radius + options.pie.radiusOffset;
	}

	/**
	 * Returns the string for the slice labels.
	 * @param datapoint data value to get the percentage
	 * @param dataset dataset containing all data values
	 */
	protected getSliceLabelText(datapoint, dataset) {
		return Tools.convertValueToPercentage(datapoint, dataset) + "%";
	}

	/**
	 * Returns the translate string for the calculated position of the slice labels.
	 * @param element the text label element
	 * @param d the d3 slice object
	 * @param radius the radius of the pie or donut chart
	 * @param totalSlices total number of slices rendered
	 */
	protected getChartLabelTranslateString(element, d, radius, totalSlices?) {
		const textLength = element.getComputedTextLength();
		const textOffsetX = textLength / 2 + 5;
		const textOffsetY = parseFloat(getComputedStyle(element).fontSize) / 2 + 5;

		const marginedRadius = radius + 2;
		// const marginedRadius = radius + Configuration.pie.label.margin;

		const theta = ((d.endAngle - d.startAngle) / 2) + d.startAngle;
		const sliceAngleDeg = (d.endAngle - d.startAngle) * (180 / Math.PI);

		const xPosition = (textOffsetX + marginedRadius) * Math.sin(theta);
		const yPosition = (textOffsetY + marginedRadius) * -Math.cos(theta);

		if (!totalSlices) {
			return `translate(${xPosition}, ${yPosition})`;
		}
		// // check if last 2 slices (or just last) are < the threshold
		// if (d.index === totalSlices - 1) {
		// 	if (sliceAngleDeg < Configuration.pie.callout.sliceDegreeThreshold) {
		// 		// start at the same location as a non-called out label
		// 		const startPos = {
		// 			x: xPosition,
		// 			y: yPosition + textOffsetY
		// 		};

		// 		// end position for the callout line
		// 		const endPos = {
		// 			x: xPosition + Configuration.pie.callout.calloutOffsetX,
		// 			y: yPosition - Configuration.pie.callout.calloutOffsetY + textOffsetY
		// 		};

		// 		// last slice always gets callout to the right side
		// 		this.drawCallout(startPos, endPos, Configuration.pie.callout.direction.RIGHT);
		// 		return `translate(${endPos.x + Configuration.pie.callout.calloutTextMargin + textOffsetX},
		// 			${yPosition - Configuration.pie.callout.calloutOffsetY})`;
		// 	}
		// 	// remove any unneeded callout for last slice
		// 	this.removeCallout(Configuration.pie.callout.direction.RIGHT);
		// }
		// if (d.index === totalSlices - 2) {
		// 	if (sliceAngleDeg < Configuration.pie.callout.sliceDegreeThreshold) {
		// 		// start position for the callout line
		// 		const startPos = {
		// 			x: xPosition,
		// 			y: yPosition + textOffsetY
		// 		};

		// 		// end position for the callout line should be bottom aligned to the title
		// 		const endPos = {
		// 			x: xPosition - Configuration.pie.callout.calloutOffsetX,
		// 			y: yPosition - Configuration.pie.callout.calloutOffsetY + textOffsetY
		// 		};

		// 		this.drawCallout(startPos, endPos, Configuration.pie.callout.direction.LEFT);
		// 		return `translate(${endPos.x - textOffsetX - Configuration.pie.callout.calloutTextMargin},
		// 			${yPosition - Configuration.pie.callout.calloutOffsetY})`;
		// 	}
		// 	// remove any leftover unneeded callout
		// 	this.removeCallout(Configuration.pie.callout.direction.LEFT);
		// }
		return `translate(${xPosition}, ${yPosition})`;
	}
}
